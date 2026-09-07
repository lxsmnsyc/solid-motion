import {fireEvent} from "@solidjs/testing-library"
import {createMotionState} from "../src/engine.js"

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

describe("createMotionState", () => {
	test("gesture state doesn't leak across mounts", async () => {
		const el = document.createElement("div")
		document.body.appendChild(el)

		// stable references so `update()` doesn't see a gesture prop change and rebind
		const hover = {opacity: 0.5}
		const transition = {duration: 0.01}
		const state = createMotionState({animate: {opacity: 1}, hover, transition})

		const dispose = state.mount(el)
		fireEvent.pointerEnter(el)
		await sleep(120)
		expect(el.style.opacity).toBe("0.5")
		dispose()

		const dispose_2 = state.mount(el)
		await sleep(120)

		// the first mount's `hover: true` must not still be layered on here
		state.update({animate: {opacity: 0.2}, hover, transition})
		await sleep(120)
		expect(el.style.opacity).toBe("0.2")

		dispose_2()
		el.remove()
	})
})
