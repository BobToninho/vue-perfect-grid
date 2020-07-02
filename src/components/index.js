import Vue from 'vue'
import GridItem from './GridItem.vue'
import GridLayout from './GridLayout.vue'

const VuePerfectGrid = {
	GridLayout,
	GridItem
}

Object.keys(VuePerfectGrid).forEach(name => {
	Vue.component(name, VuePerfectGrid[name])
})

export default VuePerfectGrid
export { GridLayout, GridItem }
