import type {Meta, StoryObj} from "storybook-solidjs-vite"
import {createSignal, For} from "solid-js"
import {Motion} from "../src/index.jsx"
import {box} from "./shared.js"

const meta = {
	title: "Motion/Layout",
} satisfies Meta

export default meta
type Story = StoryObj

const row = {...box, height: "40px", width: "200px", "margin-bottom": "8px"} as const

/** Reordering the list moves each row to its new position rather than jumping. */
export const Reorder: Story = {
	render: () => {
		const [items, setItems] = createSignal(["a", "b", "c", "d"])
		return (
			<div>
				<button onClick={() => setItems(v => [...v].reverse())}>Reverse</button>
				<div style={{"margin-top": "8px"}}>
					<For each={items()}>
						{item => (
							<Motion.div style={row} layout>
								{item}
							</Motion.div>
						)}
					</For>
				</div>
			</div>
		)
	},
}

/** Removing a row animates the ones below it up into the gap. */
export const Removal: Story = {
	render: () => {
		const [items, setItems] = createSignal(["a", "b", "c", "d"])
		return (
			<div>
				<button onClick={() => setItems(v => v.filter(x => x !== "b"))}>Remove b</button>
				<div style={{"margin-top": "8px"}}>
					<For each={items()}>
						{item => (
							<Motion.div style={row} layout layoutTransition={{duration: 0.6}}>
								{item}
							</Motion.div>
						)}
					</For>
				</div>
			</div>
		)
	},
}
