<template>
	<div ref="item" class="vue-grid-layout" :style="mergedStyle">
		<slot></slot>
		<grid-item
			class="vue-grid-placeholder"
			v-show="isDragging"
			:x="placeholder.x"
			:y="placeholder.y"
			:w="placeholder.w"
			:h="placeholder.h"
			:i="placeholder.i"
		></grid-item>
	</div>
</template>
<style>
.vue-grid-layout {
	position: relative;
	transition: height 200ms ease;
}
</style>
<script>
import Vue from 'vue'
import elementResizeDetectorMaker from 'element-resize-detector'

import GridItem from './GridItem.vue'

import {
	bottom,
	compact,
	getLayoutItem,
	moveElement,
	validateLayout,
	cloneLayout,
	getAllCollisions
} from '../helpers/utils'
import {
	getBreakpointFromWidth,
	getColsFromBreakpoint,
	findOrGenerateResponsiveLayout
} from '../helpers/responsiveUtils'
import { addWindowEventListener, removeWindowEventListener } from '../helpers/DOM'

export default {
	name: 'GridLayout',
	provide() {
		return {
			eventBus: null
		}
	},
	components: {
		GridItem
	},
	props: {
		// If true, the container height swells and contracts to fit contents
		autoSize: {
			type: Boolean,
			default: true
		},
		colNum: {
			type: Number,
			default: 12
		},
		rowHeight: {
			type: Number,
			default: 150
		},
		maxRows: {
			type: Number,
			default: Infinity
		},
		margin: {
			type: Array,
			default() {
				return [10, 10]
			}
		},
		isDraggable: {
			type: Boolean,
			default: true
		},
		isResizable: {
			type: Boolean,
			default: true
		},
		isMirrored: {
			type: Boolean,
			default: false
		},
		useCssTransforms: {
			type: Boolean,
			default: true
		},
		verticalCompact: {
			type: Boolean,
			default: true
		},
		layout: {
			type: Array,
			required: true
		},
		responsive: {
			type: Boolean,
			default: false
		},
		breakpoints: {
			type: Object,
			default() {
				return { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
			}
		},
		cols: {
			type: Object,
			default() {
				return { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }
			}
		},
		preventCollision: {
			type: Boolean,
			default: false
		}
	},
	data() {
		return {
			width: null,
			mergedStyle: {},
			lastLayoutLength: 0,
			isDragging: false,
			placeholder: {
				x: 0,
				y: 0,
				w: 0,
				h: 0,
				i: -1
			},
			layouts: {}, // array to store all layouts from different breakpoints
			lastBreakpoint: null, // store last active breakpoint
			originalLayout: null // store original Layout
		}
	},
	created() {
		// TODO Communicate with props instead of EventBus
		this._provided.eventBus = new Vue()
		this.eventBus = this._provided.eventBus
		this.eventBus.$on('resizeEvent', this.resizeEvent)
		this.eventBus.$on('dragEvent', this.dragEvent)

		// * Core Event
		this.$emit('layout-created', this.layout)
	},
	beforeDestroy() {
		// * Core Event
		this.$emit('layout-before-destroy', this.layout)

		// Remove listeners
		// TODO Communicate with props instead of EventBus
		this.eventBus.$off('resizeEvent', this.resizeEvent)
		this.eventBus.$off('dragEvent', this.dragEvent)
		this.eventBus.$destroy()
		removeWindowEventListener('resize', this.onWindowResize)
		this.erd.uninstall(this.$refs.item)
	},
	beforeMount() {
		// * Core Event
		this.$emit('layout-before-mount', this.layout)
	},
	async mounted() {
		// * Core Event
		this.$emit('layout-mounted', this.layout)

		await this.$nextTick()

		validateLayout(this.layout)
		this.originalLayout = this.layout

		await this.$nextTick()

		this.onWindowResize()
		this.initResponsiveFeatures()
		// this.width = this.$el.offsetWidth;
		addWindowEventListener('resize', this.onWindowResize)
		compact(this.layout, this.verticalCompact)
		this.updateHeight()

		await this.$nextTick()

		// ERD Initialization
		this.erd = elementResizeDetectorMaker({
			strategy: 'scroll', //<- For ultra performance.
			// See https://github.com/wnr/element-resize-detector/issues/110 about callOnAdd.
			callOnAdd: false
		})

		this.erd.listenTo(this.$refs.item, () => {
			this.onWindowResize()
		})
	},
	watch: {
		async width(newVal, oldVal) {
			await this.$nextTick()

			this.eventBus.$emit('updateWidth', this.width)
			this.updateHeight()

			/*
				oldVal === null is when the width has never been
				set before. That only occurs when mounting is
				finished, and onWindowResize has been called and
				this.width has been changed the first time after it
				got set to null in the constructor. It is now time
				to issue layout-ready events as the GridItem-s have
				their sizes configured properly.

				The reason for emitting the layout-ready event on
				the next tick is to allow for the newly-emitted
				updateWidth event (above) to have reached the
				children GridItem-s and had their effect, so we're
				sure that they have the final size before we emit
				layout-ready (for this GridLayout) and
				item-layout-ready (for the GridItem-s).

				This way any client event handlers can reliably
				invistigate stable sizes of GridItem-s.
			*/
			if (oldVal !== null) return
			await this.$nextTick()

			// * Core Event
			this.$emit('layout-ready', this.layout)
		},
		layout() {
			// ? Insert this in the core API?
			this.layoutUpdate()
		},
		colNum(val) {
			this.eventBus.$emit('setColNum', val)
		},
		rowHeight() {
			this.eventBus.$emit('setRowHeight', this.rowHeight)
		},
		isDraggable() {
			this.eventBus.$emit('setDraggable', this.isDraggable)
		},
		isResizable() {
			this.eventBus.$emit('setResizable', this.isResizable)
		},
		responsive() {
			if (!this.responsive) {
				// ? Core Event?
				this.$emit('update:layout', this.originalLayout)
				this.eventBus.$emit('setColNum', this.colNum)
			}
			this.onWindowResize()
		},
		maxRows() {
			this.eventBus.$emit('setMaxRows', this.maxRows)
		}
	},
	methods: {
		layoutUpdate() {
			if (this.layout === undefined || this.originalLayout === null) return
			console.log('### LAYOUT UPDATE!', this.layout.length, this.originalLayout.length)

			if (this.layout.length !== this.originalLayout.length) {
				let diff = this.findDifference(this.layout, this.originalLayout)
				if (diff.length > 0) {
					// console.log(diff);
					if (this.layout.length > this.originalLayout.length) {
						this.originalLayout = this.originalLayout.concat(diff)
					} else {
						this.originalLayout = this.originalLayout.filter(obj => !diff.some(obj2 => obj.i === obj2.i))
					}
				}

				this.lastLayoutLength = this.layout.length
				this.initResponsiveFeatures()
			}

			compact(this.layout, this.verticalCompact)
			this.eventBus.$emit('updateWidth', this.width)
			this.updateHeight()
		},
		updateHeight() {
			this.mergedStyle = {
				height: this.containerHeight()
			}
		},
		onWindowResize() {
			if (this.$refs !== null && this.$refs.item !== null && this.$refs.item !== undefined) {
				this.width = this.$refs.item.offsetWidth
			}
			this.eventBus.$emit('resizeEvent')
		},
		containerHeight() {
			if (!this.autoSize) return
			return bottom(this.layout) * (this.rowHeight + this.margin[1]) + this.margin[1] + 'px'
		},
		dragEvent(eventName, id, x, y, h, w) {
			// console.log(eventName + " id=" + id + ", x=" + x + ", y=" + y);
			let l = getLayoutItem(this.layout, id)
			// GetLayoutItem sometimes returns null object
			if (l === undefined || l === null) {
				l = { x: 0, y: 0 }
			}

			if (eventName === 'dragmove' || eventName === 'dragstart') {
				this.placeholder.i = id
				this.placeholder.x = l.x
				this.placeholder.y = l.y
				this.placeholder.w = w
				this.placeholder.h = h
				this.$nextTick(() => {
					this.isDragging = true
				})
				this.eventBus.$emit('updateWidth', this.width)
			} else {
				this.$nextTick(() => {
					this.isDragging = false
				})
			}

			// Move the element to the dragged location.
			this.layout = moveElement(this.layout, l, x, y, true, this.preventCollision)
			compact(this.layout, this.verticalCompact)
			// needed because vue can't detect changes on array element properties
			this.eventBus.$emit('compact')
			this.updateHeight()

			if (eventName === 'dragend') {
				this.$emit('layout-updated', this.layout)
			}
		},
		resizeEvent(eventName, id, x, y, h, w) {
			let l = getLayoutItem(this.layout, id)
			// GetLayoutItem sometimes return null object
			if (l === undefined || l === null) {
				l = { h: 0, w: 0 }
			}

			let hasCollisions
			if (this.preventCollision) {
				const collisions = getAllCollisions(this.layout, { ...l, w, h }).filter(layoutItem => layoutItem.i !== l.i)
				hasCollisions = collisions.length > 0

				// If we're colliding, we need adjust the placeholder.
				if (hasCollisions) {
					// adjust w && h to maximum allowed space
					let leastX = Infinity,
						leastY = Infinity
					collisions.forEach(layoutItem => {
						if (layoutItem.x > l.x) leastX = Math.min(leastX, layoutItem.x)
						if (layoutItem.y > l.y) leastY = Math.min(leastY, layoutItem.y)
					})

					if (Number.isFinite(leastX)) l.w = leastX - l.x
					if (Number.isFinite(leastY)) l.h = leastY - l.y
				}
			}

			if (!hasCollisions) {
				// Set new width and height.
				l.w = w
				l.h = h
			}

			if (eventName === 'resizestart' || eventName === 'resizemove') {
				this.placeholder.i = id
				this.placeholder.x = x
				this.placeholder.y = y
				this.placeholder.w = l.w
				this.placeholder.h = l.h
				this.$nextTick(function() {
					this.isDragging = true
				})
				this.eventBus.$emit('updateWidth', this.width)
			} else {
				this.$nextTick(function() {
					this.isDragging = false
				})
			}

			if (this.responsive) this.responsiveGridLayout()

			compact(this.layout, this.verticalCompact)
			this.eventBus.$emit('compact')
			this.updateHeight()

			if (eventName === 'resizeend') {
				// * Core Event
				this.$emit('layout-updated', this.layout)
			}
		},

		// finds or generates new layouts for set breakpoints
		responsiveGridLayout() {
			let newBreakpoint = getBreakpointFromWidth(this.breakpoints, this.width)
			let newCols = getColsFromBreakpoint(newBreakpoint, this.cols)

			// save actual layout in layouts
			if (this.lastBreakpoint != null && !this.layouts[this.lastBreakpoint]) {
				this.layouts[this.lastBreakpoint] = cloneLayout(this.layout)
			}

			// Find or generate a new layout.
			let layout = findOrGenerateResponsiveLayout(
				this.originalLayout,
				this.layouts,
				this.breakpoints,
				newBreakpoint,
				this.lastBreakpoint,
				newCols,
				this.verticalCompact
			)

			// Store the new layout.
			this.layouts[newBreakpoint] = layout

			// Needed to keep updated the layout prop (that is passed with .sync)
			this.$emit('update:layout', layout)

			this.lastBreakpoint = newBreakpoint
			this.eventBus.$emit('setColNum', getColsFromBreakpoint(newBreakpoint, this.cols))
		},

		// clear all responsive layouts
		initResponsiveFeatures() {
			// clear layouts
			this.layouts = {}
		},

		// find difference in layouts
		findDifference(layout, originalLayout) {
			// Find values that are in result1 but not in result2
			let uniqueResultOne = layout.filter(obj => !originalLayout.some(obj2 => obj.i === obj2.i))

			// Find values that are in result2 but not in result1
			let uniqueResultTwo = originalLayout.filter(obj => !layout.some(obj2 => obj.i === obj2.i))

			// Combine the two arrays of unique entries#
			return uniqueResultOne.concat(uniqueResultTwo)
		}
	}
}
</script>
