import {render, screen} from "@solidjs/testing-library"
import {hasReducedMotionListener, prefersReducedMotion} from "motion-dom"
import {Motion, MotionConfig} from "../src/index.jsx"

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

describe("MotionConfig", () => {
	test("Supplies a default transition to descendants", async () => {
		render(() => (
			<MotionConfig transition={{duration: 10}}>
				<Motion.div data-testid="box" initial={{opacity: 0}} animate={{opacity: 1}} />
			</MotionConfig>
		))
		const box = await screen.findByTestId("box")

		await sleep(60)
		// a 10s default is inherited, so barely any of the fade has happened
		expect(Number(box.style.opacity)).toBeLessThan(0.5)
	})

	test("An element's own transition wins over the config's", async () => {
		render(() => (
			<MotionConfig transition={{duration: 10}}>
				<Motion.div
					data-testid="box"
					initial={{opacity: 0}}
					animate={{opacity: 1}}
					transition={{duration: 0.001}}
				/>
			</MotionConfig>
		))
		const box = await screen.findByTestId("box")

		await sleep(60)
		expect(box.style.opacity).toBe("1")
	})

	test("Reduces motion for descendants", async () => {
		render(() => (
			<MotionConfig reducedMotion="always">
				<Motion.div
					data-testid="box"
					initial={{opacity: 1, x: 0}}
					animate={{opacity: 0, x: 100}}
					transition={{duration: 1}}
				/>
			</MotionConfig>
		))
		const box = await screen.findByTestId("box")

		await sleep(60)
		expect(box.style.transform).toBe("translateX(100px)")
		expect(Number(box.style.opacity)).toBeGreaterThan(0.5)
	})

	test("A nested config inherits the outer transition when it sets none", async () => {
		render(() => (
			<MotionConfig transition={{duration: 10}}>
				<MotionConfig reducedMotion="never">
					<Motion.div data-testid="box" initial={{opacity: 0}} animate={{opacity: 1}} />
				</MotionConfig>
			</MotionConfig>
		))
		const box = await screen.findByTestId("box")

		await sleep(60)
		// the inner config sets no transition, so the outer 10s one still applies
		expect(Number(box.style.opacity)).toBeLessThan(0.5)
	})

	test("reducedMotion 'user' follows the user's own setting", async () => {
		/*
		Motion keeps the resolved preference in module state behind a one-shot
		media-query listener, so it is set directly rather than through a
		matchMedia stub — which would be ignored once any earlier test had
		already caused the listener to be initialised.
		*/
		const had = hasReducedMotionListener.current
		const previous = prefersReducedMotion.current
		hasReducedMotionListener.current = true
		prefersReducedMotion.current = true

		try {
			render(() => (
				<MotionConfig reducedMotion="user">
					<Motion.div
						data-testid="box"
						initial={{x: 0}}
						animate={{x: 120}}
						transition={{duration: 1}}
					/>
				</MotionConfig>
			))
			const box = await screen.findByTestId("box")

			await sleep(60)
			// the user asked for reduced motion, so the movement is instant
			expect(box.style.transform).toBe("translateX(120px)")
		} finally {
			hasReducedMotionListener.current = had
			prefersReducedMotion.current = previous
		}
	})

	test("reducedMotion 'user' animates normally when the user has not asked", async () => {
		const had = hasReducedMotionListener.current
		const previous = prefersReducedMotion.current
		hasReducedMotionListener.current = true
		prefersReducedMotion.current = false

		try {
			render(() => (
				<MotionConfig reducedMotion="user">
					<Motion.div
						data-testid="box"
						initial={{x: 0}}
						animate={{x: 120}}
						transition={{duration: 1}}
					/>
				</MotionConfig>
			))
			const box = await screen.findByTestId("box")

			await sleep(60)
			expect(box.style.transform).not.toBe("translateX(120px)")
		} finally {
			hasReducedMotionListener.current = had
			prefersReducedMotion.current = previous
		}
	})

	test("A nested config only overrides what it sets", async () => {
		render(() => (
			<MotionConfig reducedMotion="always" transition={{duration: 10}}>
				<MotionConfig transition={{duration: 0.001}}>
					<Motion.div
						data-testid="box"
						initial={{opacity: 0, x: 0}}
						animate={{opacity: 1, x: 100}}
					/>
				</MotionConfig>
			</MotionConfig>
		))
		const box = await screen.findByTestId("box")

		await sleep(60)
		// the inner transition applies ...
		expect(box.style.opacity).toBe("1")
		// ... and the outer reducedMotion is still inherited
		expect(box.style.transform).toBe("translateX(100px)")
	})
})
