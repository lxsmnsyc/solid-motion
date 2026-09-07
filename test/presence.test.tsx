import {mountedStates} from "../src/engine.js"
import {createRoot, createSignal, flush, Show} from "solid-js"
import type {JSX} from "@solidjs/web"
import {screen, render, waitFor, fireEvent} from "@solidjs/testing-library"
import {Presence, Motion, VariantDefinition} from "../src/index.jsx"
import type {RefProps} from "@solid-primitives/refs"

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/*
Presence hands teardown over as a promise, so `done()` lands a few microtasks
after the exit animation's own completion event rather than inside its handler.
A zero-delay timer drains every pending microtask without meaningfully
advancing animation time.
*/
const tick = (): Promise<void> => sleep(0)

/*
jsdom reports an unset `opacity` as `0`, so animating to `{opacity: 0}` from the
browser default is a zero-length animation that lands in a frame or two whatever
its `duration` says. Tests below that need a *real* exit animation therefore
give the element an explicit `initial={{opacity: 1}}`.
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

	test("Removes the element even when exit resolves to no values", async () => {
		const [show, setShow] = createSignal(true)

		const {container} = render(() => (
			<Presence>
				<Show when={show()}>
					{/* a variant key with no matching entry — resolves to an empty target */}
					<Motion.div data-testid="child" animate={{opacity: 1}} exit="missing" />
				</Show>
			</Presence>
		))
		flush()

		const component = await screen.findByTestId("child")
		expect(component.isConnected).toBeTruthy()

		setShow(false)
		flush()

		await new Promise<void>(resolve => setTimeout(resolve, 50))

		expect(component.isConnected).toBeFalsy()
		expect(container.innerHTML).toBe("")
		expect(mountedStates.has(component)).toBeFalsy()
	})

	test("An element that entered during an exit still animates on later updates", async () => {
		const [condition, setCondition] = createSignal(1)
		const [opacity, setOpacity] = createSignal(0.5)

		const {container} = render(() => (
			<Presence>
				<Show when={condition()} keyed>
					{key => (
						<Motion.div
							data-testid={"child-" + key}
							animate={{opacity: opacity()}}
							exit={{opacity: 0}}
							transition={{duration: 0.001}}
						/>
					)}
				</Show>
			</Presence>
		))
		flush()
		await new Promise<void>(resolve => setTimeout(resolve, 50))

		/*
		In the default "parallel" mode the incoming element is briefly torn down
		and remounted as the outgoing one exits. Its exit flag has to be cleared
		by that remount, or every later `animate` update resolves to the exit
		target instead.
		*/
		setCondition(2)
		flush()
		await new Promise<void>(resolve => setTimeout(resolve, 50))

		const component = container.querySelector<HTMLElement>('[data-testid="child-2"]')!
		expect(component.style.opacity).toBe("0.5")

		setOpacity(0.9)
		flush()
		await new Promise<void>(resolve => setTimeout(resolve, 50))

		expect(component.style.opacity).toBe("0.9")
	})

	test("initial: false only suppresses children present on the first render", async () => {
		const [show, setShow] = createSignal(false)

		const {container} = render(() => (
			<Presence initial={false}>
				<Show when={show()}>
					<Motion.div
						data-testid="late"
						initial={{opacity: 0}}
						animate={{opacity: 1}}
						transition={{duration: 5}}
					/>
				</Show>
			</Presence>
		))
		flush()
		await new Promise<void>(resolve => setTimeout(resolve, 20))

		setShow(true)
		flush()

		// a child added after the first render animates in normally, so it starts
		// at its `initial` rather than jumping straight to `animate`
		const component = container.querySelector<HTMLElement>('[data-testid="late"]')!
		expect(component.style.opacity).toBe("0")
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

		// nothing to animate on the root itself, which used to unmount it at once
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

		// Presence transitions one element at a time — later siblings are never
		// resolved, so they're never inserted into the DOM at all
		expect(await screen.findByTestId("first")).toBeTruthy()
		expect(screen.queryByTestId("second")).toBeNull()
	})

	test("sibling Motion children warn instead of taking down the app", async () => {
		/*
		Only the first child is ever resolved, so a later `Motion` sibling is
		constructed but never inserted and its ref is never set. That used to
		throw — which halts Solid's reactive system for the whole app — and
		blamed "more than one copy of solid-js", the wrong cause for by far the
		most common way of reaching it.
		*/
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

		render(() => (
			<Presence>
				<Motion.div data-testid="first" />
				<Motion.div data-testid="second" />
			</Presence>
		))

		expect(await screen.findByTestId("first")).toBeTruthy()
		expect(screen.queryByTestId("second")).toBeNull()
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("Presence only renders the first child"),
		)

		warn.mockRestore()
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
