import {createRoot, createSignal, flush} from "solid-js"
import type {JSX} from "@solidjs/web"
import {screen, render, fireEvent} from "@solidjs/testing-library"
import {Motion} from "../src/index.jsx"
import type {Target} from "../src/index.jsx"

const duration = 0.001

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Deliver a hand-made IntersectionObserverEntry through the test stub (see test/setup.js). */
const triggerInView = (target: Element, isIntersecting: boolean): void =>
	(IntersectionObserver as any).__trigger([{target, isIntersecting}])

describe("Motion", () => {
	test("Renders element as Div by default to HTML", async () => {
		await render(() => <Motion data-testid="box"></Motion>)
		const component = await screen.findByTestId("box")
		expect(component.tagName).toEqual(`DIV`)
	})
	test("Renders element as proxy Motion.Tag to HTML", async () => {
		await render(() => <Motion.span data-testid="box"></Motion.span>)
		const component = await screen.findByTestId("box")
		expect(component.tagName).toEqual(`SPAN`)
	})
	test("Renders element as 'tag' prop to HTML", async () => {
		await render(() => <Motion tag="li" data-testid="box"></Motion>)
		const component = await screen.findByTestId("box")
		expect(component.tagName).toEqual(`LI`)
	})
	test("renders children to HTML", async () => {
		await render(() => (
			<Motion.div initial={{opacity: 0}} animate={{opacity: 1}} data-testid="box">
				<Motion.a href="foo" />
				<Motion.svg viewBox="0 0 1 1" />
			</Motion.div>
		))
		const component = await screen.findByTestId("box")
		expect(component.innerHTML).toEqual(`<a href="foo"></a><svg viewBox="0 0 1 1"></svg>`)
	})

	test("Applies initial as style to DOM node", async () => {
		await render(() => <Motion.div data-testid="box" initial={{opacity: 0.5, x: 100}} />)
		const component = await screen.findByTestId("box")
		expect(component.style.opacity).toBe("0.5")
		expect(component.style.transform).toBe("translateX(100px)")
	})

	test("Animation runs on mount if initial and animate differ", async () => {
		let ref!: HTMLDivElement
		await new Promise<void>((resolve, reject) => {
			render(() => {
				return (
					<Motion.div
						ref={ref}
						initial={{opacity: 0.4}}
						animate={{opacity: [0, 0.8]}}
						onMotionComplete={() => resolve()}
						transition={{duration}}
					/>
				)
			})
			setTimeout(() => reject(false), 200)
		})
		expect(ref.style.opacity).toBe("0.8")
	})

	test("Animation doesn't run on mount if initial and animate are the same", async () => {
		const element = await new Promise((resolve, reject) => {
			const Component = (): JSX.Element => {
				const animate = {opacity: 0.4}
				return (
					<Motion.div
						initial={animate}
						animate={animate}
						onMotionComplete={() => reject(false)}
						transition={{duration}}
					/>
				)
			}
			render(Component)
			setTimeout(() => resolve(true), 200)
		})
		expect(element).toBe(true)
	})

	test("Animation runs when target changes", async () => {
		const result = await new Promise(resolve =>
			createRoot(dispose => {
				const Component = (props: any): JSX.Element => {
					return (
						<Motion.div
							initial={{opacity: 0}}
							animate={props.animate}
							onMotionComplete={({detail}) => {
								if (detail.target.opacity === 0.8) resolve(true)
							}}
							transition={{duration}}
						/>
					)
				}
				const [animate, setAnimate] = createSignal({opacity: 0.5})
				render(() => <Component animate={animate()} />)
				setAnimate({opacity: 0.8})
				setTimeout(dispose, 20)
			}),
		)
		expect(result).toBe(true)
	})

	test("Accepts default transition", async () => {
		const element = await new Promise<HTMLElement>(resolve => {
			let ref!: HTMLDivElement
			render(() => (
				<Motion.div
					ref={ref}
					initial={{opacity: 0.5}}
					animate={{opacity: 0.9}}
					transition={{duration: 10}}
				/>
			))
			setTimeout(() => resolve(ref), 500)
		})
		expect(element.style.opacity).not.toEqual("0.9")
	})

	test("animate default transition", async () => {
		const element = await new Promise<HTMLElement>(resolve => {
			let ref!: HTMLDivElement
			render(() => (
				<Motion.div
					ref={ref}
					initial={{opacity: 0.5}}
					animate={{opacity: 0.9, transition: {duration: 10}}}
				/>
			))
			setTimeout(() => resolve(ref), 500)
		})
		expect(element.style.opacity).not.toEqual("0.9")
	})

	test("Passes event handlers", async () => {
		const captured: any[] = []
		const element = await new Promise<HTMLElement>(resolve => {
			let ref!: HTMLDivElement
			render(() => (
				<Motion.div ref={ref} hover={{scale: 2}} onHoverStart={() => captured.push(0)} />
			))
			setTimeout(() => resolve(ref), 1)
		})
		fireEvent.pointerEnter(element)
		expect(captured).toEqual([0])
	})

	test("hover reverts to the start value without an `animate` prop", async () => {
		let ref!: HTMLDivElement
		render(() => (
			<Motion.div
				ref={ref}
				initial={{opacity: 0.3}}
				hover={{opacity: 1}}
				transition={{duration: 0.01}}
			/>
		))
		expect(ref.style.opacity).toBe("0.3")

		fireEvent.pointerEnter(ref)
		await sleep(120)
		expect(ref.style.opacity).toBe("1")

		fireEvent.pointerLeave(ref)
		await sleep(120)
		expect(ref.style.opacity).toBe("0.3")
	})

	test("press reverts to the element's own resting value", async () => {
		let ref!: HTMLDivElement
		render(() => (
			<Motion.div
				ref={ref}
				hover={{scale: 1.2}}
				press={{scale: 0.9}}
				transition={{duration: 0.01}}
			/>
		))

		fireEvent.pointerEnter(ref)
		await sleep(120)
		expect(ref.style.transform).toContain("scale(1.2)")

		fireEvent.pointerDown(ref)
		await sleep(120)
		expect(ref.style.transform).toContain("scale(0.9)")

		// press ends, hover is still active — falls back to the hover layer
		fireEvent.pointerUp(ref)
		await sleep(120)
		expect(ref.style.transform).toContain("scale(1.2)")

		// and back to the element's own resting scale of 1, which Motion
		// serializes as an identity transform
		fireEvent.pointerLeave(ref)
		await sleep(120)
		expect(ref.style.transform).toBe("none")
	})

	test("onViewEnter receives the IntersectionObserverEntry", async () => {
		let entry: IntersectionObserverEntry | undefined
		let ref!: HTMLDivElement
		render(() => (
			<Motion.div
				ref={ref}
				inView={{opacity: 0.5}}
				onViewEnter={({detail}) => (entry = detail.originalEntry)}
				transition={{duration: 0.01}}
			/>
		))

		triggerInView(ref, true)

		expect(entry).toBeDefined()
		expect(entry!.target).toBe(ref)
		expect(entry!.isIntersecting).toBe(true)
	})

	test("the inView layer survives a reactive animate change", async () => {
		const [animate, setAnimate] = createSignal<Target>({opacity: 0.2})
		let ref!: HTMLDivElement
		render(() => (
			<Motion.div
				ref={ref}
				animate={animate()}
				inView={{opacity: 0.8}}
				transition={{duration: 0.01}}
			/>
		))

		triggerInView(ref, true)
		await sleep(120)
		expect(ref.style.opacity).toBe("0.8")

		setAnimate({opacity: 0.3})
		flush()
		await sleep(120)
		// still in view, so the inView layer keeps priority over the new `animate`
		expect(ref.style.opacity).toBe("0.8")

		triggerInView(ref, false)
		await sleep(120)
		expect(ref.style.opacity).toBe("0.3")
	})

	test("Motion.tag access is cached", () => {
		expect(Motion.div).toBe(Motion.div)
		expect(Motion.span).not.toBe(Motion.div)
	})

	test("Motion isn't thenable", async () => {
		expect((Motion as any).then).toBeUndefined()
		await expect(Promise.resolve(Motion)).resolves.toBe(Motion)
	})
})
