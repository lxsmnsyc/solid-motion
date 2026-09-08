import type {Meta, StoryObj} from "storybook-solidjs-vite"
import {createSignal, For, Show} from "solid-js"
import type {JSX} from "@solidjs/web"
import {Motion, Presence} from "../src/index.jsx"
import {box} from "./shared.js"

const meta = {
	title: "Motion/Presence",
} satisfies Meta

export default meta
type Story = StoryObj

/** `exit` runs before the element is actually removed from the DOM. */
export const Basic: Story = {
	render: () => {
		const [show, setShow] = createSignal(true)
		return (
			<div>
				<button onClick={() => setShow(v => !v)}>Toggle</button>
				<Presence>
					<Show when={show()}>
						<Motion.div
							style={box}
							initial={{opacity: 0}}
							animate={{opacity: 1}}
							exit={{opacity: 0, scale: 0.5}}
							transition={{duration: 0.4}}
						/>
					</Show>
				</Presence>
			</div>
		)
	},
}

/** `exitBeforeEnter` holds the incoming element back until the outgoing one has left. */
export const ExitBeforeEnter: Story = {
	render: () => {
		const [first, setFirst] = createSignal(true)
		const El = (props: {label: string; color: string}): JSX.Element => (
			<Motion.div
				style={{...box, background: props.color}}
				initial={{opacity: 0}}
				animate={{opacity: 1}}
				exit={{opacity: 0}}
				transition={{duration: 0.4}}
			>
				{props.label}
			</Motion.div>
		)
		return (
			<div>
				<button onClick={() => setFirst(v => !v)}>Swap</button>
				<Presence exitBeforeEnter>
					<Show
						when={first()}
						children={<El label="a" color="royalblue" />}
						fallback={<El label="b" color="seagreen" />}
					/>
				</Presence>
			</div>
		)
	},
}

/** Removing one item from a list animates only that item out. */
export const List: Story = {
	render: () => {
		const [items, setItems] = createSignal([1, 2, 3, 4])
		return (
			<div>
				<button onClick={() => setItems(v => v.slice(0, -1))}>Remove last</button>
				<button onClick={() => setItems(v => [...v, (v.at(-1) ?? 0) + 1])}>Add</button>
				<div style={{display: "flex", gap: "8px", "margin-top": "8px"}}>
					<Presence>
						<For each={items()}>
							{item => (
								<Motion.div
									style={{...box, width: "48px", height: "48px"}}
									initial={{opacity: 0, y: -20}}
									animate={{opacity: 1, y: 0}}
									exit={{opacity: 0, y: 20}}
									transition={{duration: 0.3}}
								>
									{item}
								</Motion.div>
							)}
						</For>
					</Presence>
				</div>
			</div>
		)
	},
}
