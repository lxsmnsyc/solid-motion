import {createRoot} from "solid-js"
import {render, screen} from "@solidjs/testing-library"
import {Motion, createMotionValue, createSpring, createTransform} from "../src/index.jsx"

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

describe("MotionValue", () => {
	test("A value in `style` is written straight to the element", async () => {
		const x = createRoot(() => createMotionValue(0))

		render(() => <Motion.div data-testid="box" style={{x}} />)
		const box = await screen.findByTestId("box")

		x.set(120)
		await sleep(60)
		expect(box.style.transform).toBe("translateX(120px)")
	})

	test("A value in `style` sits alongside ordinary CSS", async () => {
		const x = createRoot(() => createMotionValue(10))

		render(() => <Motion.div data-testid="box" style={{x, color: "red"}} />)
		const box = await screen.findByTestId("box")

		await sleep(60)
		expect(box.style.color).toBe("red")
		expect(box.style.transform).toBe("translateX(10px)")
	})

	test("Animating a property retargets the caller's own value", async () => {
		const x = createRoot(() => createMotionValue(0))

		render(() => (
			<Motion.div
				data-testid="box"
				style={{x}}
				animate={{x: 80}}
				transition={{duration: 0.001}}
			/>
		))
		await screen.findByTestId("box")

		await sleep(80)
		// the animation drove the value the caller is holding, not a private copy
		expect(x.get()).toBe(80)
	})

	/*
	A derived value recomputes on Motion's own frame loop rather than on the
	write, so that a burst of updates in one frame costs one recomputation.
	*/
	test("createTransform maps an input range onto an output range", async () => {
		const {progress, opacity, dispose} = createRoot(dispose => {
			const progress = createMotionValue(0)
			return {progress, opacity: createTransform(progress, [0, 100], [0, 1]), dispose}
		})

		expect(opacity.get()).toBe(0)

		progress.set(50)
		await sleep(30)
		expect(opacity.get()).toBeCloseTo(0.5, 5)

		dispose()
	})

	test("createTransform computes from any values it reads", async () => {
		const {a, sum, dispose} = createRoot(dispose => {
			const a = createMotionValue(2)
			const b = createMotionValue(3)
			return {a, sum: createTransform(() => a.get() + b.get()), dispose}
		})

		expect(sum.get()).toBe(5)

		a.set(10)
		await sleep(30)
		expect(sum.get()).toBe(13)

		dispose()
	})

	test("createSpring follows its source", async () => {
		const {spring, source, dispose} = createRoot(dispose => {
			const source = createMotionValue(0)
			return {spring: createSpring(source), source, dispose}
		})

		source.set(100)
		await sleep(80)

		// still on its way — a spring lags rather than jumping
		expect(spring.get()).toBeGreaterThan(0)
		expect(spring.get()).toBeLessThan(100)

		dispose()
	})

	test("Works outside an owner, with nothing to tie its lifetime to", () => {
		// a bare module-scope value has no owner to dispose it; it must not throw
		const x = createMotionValue(5)
		expect(x.get()).toBe(5)
	})

	test("A derived value is torn down with its owner", async () => {
		const a = createRoot(() => createMotionValue(1))
		let derived!: ReturnType<typeof createTransform<number>>

		const dispose = createRoot(dispose => {
			derived = createTransform(() => a.get() * 2)
			return dispose
		})

		expect(derived.get()).toBe(2)
		dispose()

		// destroyed with the owner, so it no longer tracks its source
		a.set(50)
		await sleep(30)
		expect(derived.get()).toBe(2)
	})
})
