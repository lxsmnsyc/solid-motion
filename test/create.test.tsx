import {render, screen} from "@solidjs/testing-library"
import type {JSX} from "@solidjs/web"
import {Motion, createMotionComponent} from "../src/index.jsx"

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** A component of the kind a consumer would already have: forwards ref and style. */
const Card = (props: {
	ref?: (el: Element) => void
	style?: JSX.CSSProperties | string
	label?: string
	animate?: unknown
}): JSX.Element => (
	<article data-testid="card" ref={props.ref} style={props.style} data-label={props.label}>
		{props.label}
		{/* proves whether the animation props were forwarded */}
		<span data-testid="forwarded">{props.animate ? "yes" : "no"}</span>
	</article>
)

describe("Motion.create", () => {
	test("Animates the element a wrapped component forwards its ref to", async () => {
		const MotionCard = Motion.create(Card)
		render(() => (
			<MotionCard
				label="Hello"
				initial={{opacity: 0}}
				animate={{opacity: 0.8}}
				transition={{duration: 0.001}}
			/>
		))
		const card = await screen.findByTestId("card")

		expect(card.tagName).toBe("ARTICLE")
		expect(card.style.opacity).toBe("0")

		await sleep(120)
		expect(card.style.opacity).toBe("0.8")
	})

	test("Passes non-animation props through and keeps the component's own style", async () => {
		const MotionCard = Motion.create(Card)
		render(() => <MotionCard label="Titled" style={{color: "red"}} initial={{opacity: 0.5}} />)
		const card = await screen.findByTestId("card")

		expect(card.dataset["label"]).toBe("Titled")
		// the caller's own style survives alongside the resolved initial
		expect(card.style.color).toBe("red")
		expect(card.style.opacity).toBe("0.5")
	})

	test("Strips the animation props by default", async () => {
		const MotionCard = Motion.create(Card)
		render(() => <MotionCard label="x" animate={{opacity: 1}} />)
		expect((await screen.findByTestId("forwarded")).textContent).toBe("no")
	})

	test("forwardMotionProps passes them through as well", async () => {
		const MotionCard = Motion.create(Card, {forwardMotionProps: true})
		render(() => <MotionCard label="x" animate={{opacity: 1}} />)
		expect((await screen.findByTestId("forwarded")).textContent).toBe("yes")
	})

	test("Motion.create is the standalone factory, not a `<create>` element", () => {
		expect(Motion.create).toBe(createMotionComponent)
	})
})
