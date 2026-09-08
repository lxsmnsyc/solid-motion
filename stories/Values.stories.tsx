import type {Meta, StoryObj} from "storybook-solidjs-vite"
import {Motion, createMotionValue, createSpring, createTransform} from "../src/index.jsx"
import {accent, box} from "./shared.js"

const meta = {
	title: "Motion/Motion values",
} satisfies Meta

export default meta
type Story = StoryObj

/*
A MotionValue bound through `style` is written straight to the element on
Motion's own frame loop, never touching Solid's graph — so dragging the slider
at 60fps re-renders nothing.
*/
export const Bound: Story = {
	render: () => {
		const x = createMotionValue(0)
		const opacity = createTransform(x, [0, 240], [1, 0.2])
		return (
			<div>
				<input
					type="range"
					min="0"
					max="240"
					value="0"
					onInput={e => x.set(Number(e.currentTarget.value))}
				/>
				<Motion.div style={{...box, x, opacity}} />
			</div>
		)
	},
}

/** `createSpring` follows its source with lag instead of tracking it exactly. */
export const Spring: Story = {
	render: () => {
		const x = createMotionValue(0)
		const smooth = createSpring(x, {stiffness: 200, damping: 30})
		return (
			<div>
				<button onClick={() => x.set(x.get() === 0 ? 240 : 0)}>Move</button>
				<Motion.div style={{...box, x}} />
				<Motion.div style={{...accent, x: smooth}} />
			</div>
		)
	},
}

/** `createTransform` maps one value's range onto another's. */
export const Transform: Story = {
	render: () => {
		const x = createMotionValue(0)
		const rotate = createTransform(x, [0, 240], [0, 360])
		const background = createTransform(x, [0, 240], ["royalblue", "seagreen"])
		return (
			<div>
				<input
					type="range"
					min="0"
					max="240"
					value="0"
					onInput={e => x.set(Number(e.currentTarget.value))}
				/>
				<Motion.div style={{...box, x, rotate, background}} />
			</div>
		)
	},
}
