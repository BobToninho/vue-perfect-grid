import Vue from 'vue'
import GridItem from './GridItem.vue'
import GridLayout from './GridLayout.vue'
// import ResponsiveGridLayout from './ResponsiveGridLayout.vue';

const VuePerfectGrid = {
	// ResponsiveGridLayout,
	GridLayout,
	GridItem
}

// module.exports = VueGridLayout;

Object.keys(VuePerfectGrid).forEach(name => {
	Vue.component(name, VuePerfectGrid[name])
})

export default VuePerfectGrid
export { GridLayout, GridItem }
