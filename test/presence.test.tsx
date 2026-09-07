import {mountedStates} from "../src/engine.js"
import {createRoot, createSignal, flush, Show} from "solid-js"
import type {JSX} from "@solidjs/web"
import {screen, render, fireEvent, waitFor} from "@solidjs/testing-library"
import {Presence, Motion, VariantDefinition} from "../src/index.jsx"
import type {RefProps} from "@solid-primitives/refs"

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/*
Presence hands teardown over as a promise, so `done()` lands a few microtasks
after the exit animation's own completion event. A zero-delay timer drains
every pending microtask without advancing animation time meaningfully.
*/
const tick = (): Promise<void> => sleep(0)

/*
jsdom reports an unset `opacity` as `0`, so animating to `{opacity: 0}` from
the browser default would be a zero-length animation that lands in a frame or
two regardless of its `duration`. Tests below that need a *real* exit
animation therefore give the element an explicit `initial={{opacity: 1}}`.
*/

const TestComponent = (
	props: {
		initial?: boolean
		show?: boolean
		animate?: VariantDefinition
		exit?: VariantDefinition
	} = {},
): JSX.Element => {
	return (
		<Presence initial={props.initial ?? true}>
			<Show when={props.show ?? true}>
				<Motion.div data-testid="child" animate={props.animate} exit={props.exit} />
			</Show>
		</Presence>
	)
}

describe("Presence", () => {
	test("Renders element", async () => {
		render(TestComponent)
		const component = await screen.findByTestId("child")
		expect(component).toBeTruthy()
	})

	test("On initial Presence render, initial: false applies to children", () => {
		const wrapper = render(() => (
			<TestComponent show initial={false} animate={{opacity: 0.5}} />
		))
		flush()
		expect(wrapper.container.outerHTML).toEqual(
			`<div><div data-testid="child" style="opacity: 0.5;"></div></div>`,
		)
	})

	test("Animates element out", () =>
		createRoot(async () => {
			const [show, setShow] = createSignal(true)
			render(() => (
				<TestComponent show={show()} exit={{opacity: 0, transition: {duration: 0.001}}} />
			))
			const component = await screen.findByTestId("child")
			expect(component.style.opacity).toBe("")
			expect(component.isConnected).toBeTruthy()

			setShow(false)

			expect(component.style.opacity).toBe("")
			expect(component.isConnected).toBeTruthy()

			return new Promise<void>(resolve => {
				setTimeout(() => {
					expect(component.style.opacity).toBe("0")
					expect(component.isConnected).toBeFalsy()
					resolve()
				}, 100)
			})
		}))

	test("All children run their exit animation", async () => {
		const [show, setShow] = createSignal(true)

		let ref_1!: HTMLDivElement, ref_2!: HTMLDivElement
		let resolve_1: () => void, resolve_2: () => void

		const exit_animation: VariantDefinition = {
			opacity: 0,
			transition: {duration: 0.001},
		}

		const {container} = render(() => (
			<Presence>
				<Show when={show()}>
					<Motion ref={ref_1} exit={exit_animation} onMotionComplete={() => resolve_1()}>
						<Motion
							ref={ref_2}
							exit={exit_animation}
							onMotionComplete={() => resolve_2()}
						/>
					</Motion>
				</Show>
			</Presence>
		))

		expect(container.contains(ref_1)).toBeTruthy()
		expect(ref_1.firstChild).toBe(ref_2)
		expect(ref_1.style.opacity).toBe("")
		expect(ref_2.style.opacity).toBe("")
		expect(mountedStates.has(ref_1)).toBeTruthy()
		expect(mountedStates.has(ref_2)).toBeTruthy()

		setShow(false)
		flush()

		expect(container.contains(ref_1)).toBeTruthy()
		expect(ref_1.style.opacity).toBe("")
		expect(ref_2.style.opacity).toBe("")

		await new Promise<void>(resolve => {
			let count = 0
			resolve_1 = resolve_2 = () => {
				if (++count === 2) resolve()
			}
		})

		expect(ref_1.style.opacity).toBe("0")
		expect(ref_2.style.opacity).toBe("0")

		await tick()

		expect(container.contains(ref_1)).toBeFalsy()
		expect(mountedStates.has(ref_1)).toBeFalsy()
		expect(mountedStates.has(ref_2)).toBeFalsy()
	})

	test("exitBeforeEnter delays enter animation until exit animation is complete", async () => {
		const [condition, setCondition] = createSignal(true)

		let ref_1!: HTMLDivElement, ref_2!: HTMLDivElement
		let resolve_last: (() => void) | undefined

		const El = (props: RefProps<HTMLDivElement>): JSX.Element => (
			<Motion.div
				ref={props.ref}
				initial={{opacity: 0}}
				animate={{opacity: 1}}
				exit={{opacity: 0}}
				transition={{duration: 0.001}}
				onMotionComplete={() => resolve_last?.()}
			/>
		)

		const {container} = render(() => (
			<Presence exitBeforeEnter>
				<Show
					when={condition()}
					children={<El ref={ref_1} />}
					fallback={<El ref={ref_2} />}
				/>
			</Presence>
		))

		expect(container.contains(ref_1)).toBeTruthy()
		expect(ref_1.style.opacity).toBe("0")

		// enter 1
		await new Promise<void>(resolve => (resolve_last = resolve))

		expect(container.contains(ref_1)).toBeTruthy()
		expect(ref_1.style.opacity).toBe("1")

		setCondition(false)
		flush()

		expect(container.contains(ref_1)).toBeTruthy()
		expect(container.contains(ref_2)).toBeFalsy()
		expect(ref_1.style.opacity).toBe("1")
		expect(ref_2.style.opacity).toBe("0")

		// exit 1
		await new Promise<void>(resolve => (resolve_last = resolve))

		// arm the next waiter before yielding, so enter 2 can't complete unobserved
		const entered_2 = new Promise<void>(resolve => (resolve_last = resolve))
		await tick()

		expect(container.contains(ref_2)).toBeTruthy()
		expect(container.contains(ref_1)).toBeFalsy()
		expect(ref_1.style.opacity).toBe("0")
		expect(ref_2.style.opacity).toBe("0")

		// enter 2
		await entered_2

		expect(container.contains(ref_2)).toBeTruthy()
		expect(container.contains(ref_1)).toBeFalsy()
		expect(ref_1.style.opacity).toBe("0")
		expect(ref_2.style.opacity).toBe("1")
	})
	test("waits for a nested descendant's longer exit before removing the subtree", async () => {
		const [show, setShow] = createSignal(true)
		let parent!: HTMLDivElement, child!: HTMLDivElement

		render(() => (
			<Presence>
				<Show when={show()}>
					<Motion.div
						ref={parent}
						initial={{opacity: 1}}
						exit={{opacity: 0, transition: {duration: 0.01}}}
					>
						<Motion.div
							ref={child}
							initial={{opacity: 1}}
							exit={{opacity: 0, transition: {duration: 0.5}}}
						/>
					</Motion.div>
				</Show>
			</Presence>
		))

		expect(parent.isConnected).toBeTruthy()

		setShow(false)
		flush()

		// the parent's own 10ms exit has long since landed, but the child's
		// 500ms exit has not — the subtree must stay mounted for the child
		await sleep(120)
		expect(parent.isConnected).toBeTruthy()
		expect(child.isConnected).toBeTruthy()

		await waitFor(() => expect(parent.isConnected).toBeFalsy(), {timeout: 2000})
	})

	test("waits for a descendant's exit even when the root has none", async () => {
		const [show, setShow] = createSignal(true)
		let root!: HTMLDivElement, child!: HTMLDivElement

		render(() => (
			<Presence>
				<Show when={show()}>
					<Motion.div ref={root}>
						<Motion.div
							ref={child}
							initial={{opacity: 1}}
							exit={{opacity: 0, transition: {duration: 0.3}}}
						/>
					</Motion.div>
				</Show>
			</Presence>
		))

		setShow(false)
		flush()

		// nothing to animate on the root itself, so today it unmounts at once
		await sleep(80)
		expect(root.isConnected).toBeTruthy()
		expect(child.isConnected).toBeTruthy()

		await waitFor(() => expect(root.isConnected).toBeFalsy(), {timeout: 2000})
	})

	test("waits for a descendant's exit when the Presence child is a plain element", async () => {
		const [show, setShow] = createSignal(true)
		let wrapper!: HTMLDivElement, child!: HTMLDivElement

		render(() => (
			<Presence>
				<Show when={show()}>
					<div ref={wrapper}>
						<Motion.div
							ref={child}
							initial={{opacity: 1}}
							exit={{opacity: 0, transition: {duration: 0.3}}}
						/>
					</div>
				</Show>
			</Presence>
		))

		setShow(false)
		flush()

		await sleep(80)
		expect(wrapper.isConnected).toBeTruthy()
		expect(child.isConnected).toBeTruthy()

		await waitFor(() => expect(wrapper.isConnected).toBeFalsy(), {timeout: 2000})
	})

	test.each([
		["a variant key with no matching variant", "nope" as VariantDefinition],
		["a target carrying only a transition", {transition: {duration: 0.3}} as VariantDefinition],
	])("removes the element when `exit` resolves to no animatable values (%s)", async (_, exit) => {
		const [show, setShow] = createSignal(true)
		let el!: HTMLDivElement

		render(() => (
			<Presence>
				<Show when={show()}>
					<Motion.div ref={el} exit={exit} />
				</Show>
			</Presence>
		))

		expect(el.isConnected).toBeTruthy()

		setShow(false)
		flush()

		// an `exit` with nothing to animate must not pin the element forever
		await waitFor(() => expect(el.isConnected).toBeFalsy(), {timeout: 1000})
	})

	test("a gesture landing mid-exit doesn't truncate the exit animation", async () => {
		const [show, setShow] = createSignal(true)
		let el!: HTMLDivElement

		render(() => (
			<Presence>
				<Show when={show()}>
					<Motion.div
						ref={el}
						initial={{opacity: 1}}
						hover={{opacity: 0.5}}
						exit={{opacity: 0, transition: {duration: 0.3}}}
					/>
				</Show>
			</Presence>
		))

		fireEvent.pointerEnter(el)
		setShow(false)
		flush()
		fireEvent.pointerLeave(el)

		await sleep(150)
		expect(el.isConnected).toBeTruthy()

		await waitFor(() => expect(el.isConnected).toBeFalsy(), {timeout: 2000})
	})

	test("renders only the first of several sibling children", async () => {
		render(() => (
			<Presence>
				<div data-testid="first" />
				<div data-testid="second" />
			</Presence>
		))

		// Presence transitions one element at a time — later siblings are
		// never resolved, so they're never inserted into the DOM at all
		expect(await screen.findByTestId("first")).toBeTruthy()
		expect(screen.queryByTestId("second")).toBeNull()
	})

	test("sibling Motion elements wrapped in a common parent all render", async () => {
		render(() => (
			<Presence>
				<div>
					<Motion.div data-testid="first" />
					<Motion.div data-testid="second" />
				</div>
			</Presence>
		))

		expect(await screen.findByTestId("first")).toBeTruthy()
		expect(screen.queryByTestId("second")).toBeTruthy()
	})
})
