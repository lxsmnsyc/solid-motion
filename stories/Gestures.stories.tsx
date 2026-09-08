import type {Meta, StoryObj} from "storybook-solidjs-vite"
import {createSignal} from "solid-js"
import {Motion} from "../src/index.jsx"
import {box, row} from "./shared.js"

const meta = {
	title: "Motion/Gestures",
} satisfies Meta

export default meta
type Story = StoryObj

/** Hovering animates to the hover target; leaving animates back to the base. */
export const Hover: Story = {
	render: () => {
		const [status, setStatus] = createSignal("idle")
		return (
			<div>
				<p>hover: {status()}</p>
				<Motion.div
					style={box}
					hover={{scale: 1.2, backgroundColor: "seagreen"}}
					transition={{duration: 0.15}}
					onHoverStart={() => setStatus("active")}
					onHoverEnd={() => setStatus("idle")}
				/>
			</div>
		)
	},
}

/** Pressing and releasing animates to and from the press target. */
export const Press: Story = {
	render: () => {
		const [status, setStatus] = createSignal("idle")
		return (
			<div>
				<p>press: {status()}</p>
				<Motion.div
					style={box}
					press={{scale: 0.85, backgroundColor: "crimson"}}
					transition={{duration: 0.1}}
					onPressStart={() => setStatus("active")}
					onPressEnd={() => setStatus("idle")}
				/>
			</div>
		)
	},
}

/*
Layering: press sits on top of hover, so pressing while hovering wins for any
key the two share. Releasing falls back to hover rather than to the base, as
long as the pointer is still over the element.
*/
export const PressOverHover: Story = {
	render: () => (
		<Motion.div
			style={box}
			hover={{opacity: 0.7, scale: 1.2}}
			press={{opacity: 0.2}}
			transition={{duration: 0.15}}
		/>
	),
}

/*
The resting value comes from `initial` when it sets one, not from the
property's zero value — the case that breaks for transforms, which can only be
read back out of a computed matrix.
*/
export const RevertsToInitial: Story = {
	render: () => (
		<div style={{padding: "48px"}}>
			<Motion.div
				style={box}
				initial={{scale: 2, opacity: 0.3}}
				hover={{scale: 3, opacity: 0.9}}
				transition={{duration: 0.1}}
			/>
		</div>
	),
}

/*
`focus` is gated on `:focus-visible`, so it fires for keyboard focus and not
for a plain mouse click — matching the browser's own focus ring. Tab into the
second field to see it.
*/
export const Focus: Story = {
	render: () => (
		<div style={row}>
			<input placeholder="tab from here" />
			<Motion.input
				style={{...box, border: "none"}}
				focus={{scale: 1.2, backgroundColor: "seagreen"}}
				transition={{duration: 0.15}}
			/>
		</div>
	),
}
