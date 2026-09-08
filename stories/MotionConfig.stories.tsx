import type {Meta, StoryObj} from "storybook-solidjs-vite"
import {createSignal} from "solid-js"
import {Motion, MotionConfig} from "../src/index.jsx"
import {box} from "./shared.js"

const meta = {
	title: "Motion/MotionConfig",
} satisfies Meta

export default meta
type Story = StoryObj

/** A transition set on the provider is inherited by every descendant. */
export const InheritedTransition: Story = {
	render: () => {
		const [on, setOn] = createSignal(false)
		return (
			<MotionConfig transition={{duration: 1.5}}>
				<button onClick={() => setOn(v => !v)}>Toggle</button>
				<Motion.div style={box} animate={{x: on() ? 200 : 0}} />
			</MotionConfig>
		)
	},
}

/*
`reducedMotion: "always"` applies movement instantly but still fades, matching
the platform convention of dropping motion rather than dropping feedback.
*/
export const ReducedMotion: Story = {
	render: () => {
		const [on, setOn] = createSignal(false)
		return (
			<MotionConfig reducedMotion="always">
				<button onClick={() => setOn(v => !v)}>Toggle</button>
				<Motion.div
					style={box}
					animate={{x: on() ? 200 : 0, opacity: on() ? 0.3 : 1}}
					transition={{duration: 1}}
				/>
			</MotionConfig>
		)
	},
}
