import {expect, test} from "@playwright/test"
import {computed, opacity, openDemo, settled, translateX, translateY} from "./helpers.js"

test.describe("Presence lists", () => {
	test("removing one item animates only that item out", async ({page}) => {
		await openDemo(page, "presence-list")

		await expect(page.getByTestId("item-2")).toBeVisible()
		await page.getByTestId("remove").click()

		// the removed item fades in place; its siblings are untouched
		await expect.poll(() => opacity(page.getByTestId("item-2"))).toBeLessThan(0.9)
		expect(await opacity(page.getByTestId("item-1"))).toBeCloseTo(1, 1)
		expect(await opacity(page.getByTestId("item-3"))).toBeCloseTo(1, 1)

		await expect(page.getByTestId("item-2")).toHaveCount(0)
		await expect(page.getByTestId("item-1")).toBeVisible()
		await expect(page.getByTestId("item-3")).toBeVisible()
	})

	test("siblings removed together leave on their own schedules", async ({page}) => {
		await openDemo(page, "presence-list-stagger")

		await expect(page.getByTestId("quick")).toBeVisible()
		await page.getByTestId("toggle").click()

		// the 0.15s exit is gone well before the 1.5s one
		await expect(page.getByTestId("quick")).toHaveCount(0)
		await expect(page.getByTestId("slow")).toBeAttached()

		await expect(page.getByTestId("slow")).toHaveCount(0)
	})
})

test.describe("focus", () => {
	test("keyboard focus triggers the focus target, and blur reverts it", async ({page}) => {
		await openDemo(page, "focus")
		const box = page.getByTestId("box")

		expect(Number(await settled(box))).toBeCloseTo(1, 1)

		// tab in, so the browser treats it as :focus-visible. Clicked rather than
		// focused programmatically, so the window itself is focused as well —
		// WebKit will not deliver Tab to a page that isn't.
		await page.getByTestId("before").click()
		await page.keyboard.press("Tab")
		await expect(box).toBeFocused()
		expect(Number(await settled(box))).toBeCloseTo(0.3, 1)

		// and out again, to the input after it
		await page.keyboard.press("Tab")
		await expect(page.getByTestId("after")).toBeFocused()
		expect(Number(await settled(box))).toBeCloseTo(1, 1)
	})

	/*
	The accessibility-relevant half of the contract: `focus` is gated on
	`:focus-visible`, so clicking a button focuses it without animating. A
	button is used deliberately — a text input always matches `:focus-visible`
	even when clicked, because it will accept keyboard input next.
	*/
	test("a mouse click focuses without triggering the focus target", async ({page}) => {
		await openDemo(page, "focus-and-press")
		const box = page.getByTestId("box")

		await box.click()
		await page.mouse.move(600, 600)

		expect(await box.evaluate(el => el.matches(":focus-visible"))).toBe(false)
		expect(Number(await settled(box))).toBeCloseTo(1, 1)
	})
})

test.describe("MotionConfig", () => {
	/*
	Reduced motion applies positional values instantly and keeps animating the
	rest, which is what makes it an accessibility feature rather than an
	off switch.
	*/
	test("reducedMotion applies movement instantly but still fades", async ({page}) => {
		await openDemo(page, "reduced-motion")
		const box = page.getByTestId("box")

		await expect.poll(() => translateX(box)).toBeCloseTo(200, 0)
		// the 1.5s fade is still only just beginning
		expect(await opacity(box)).toBeGreaterThan(0.5)
	})

	test("a config transition is inherited by descendants", async ({page}) => {
		await openDemo(page, "config-transition")
		// a 1.5s inherited duration, so the fade is nowhere near done
		expect(await opacity(page.getByTestId("box"))).toBeLessThan(0.9)
	})
})

test.describe("Motion.create", () => {
	test("animates the element a wrapped component refs", async ({page}) => {
		await openDemo(page, "create-component")
		const box = page.getByTestId("box")

		expect(await box.evaluate(el => el.tagName)).toBe("ARTICLE")
		expect(Number(await settled(box))).toBeCloseTo(1, 1)
		// the component's own style survives alongside the animated one
		expect(await computed(box, "width")).toBe("80px")
	})
})

test.describe("motion values", () => {
	test("a value bound through style drives the element", async ({page}) => {
		await openDemo(page, "values")
		const box = page.getByTestId("box")

		expect(await translateX(box)).toBeCloseTo(0, 0)

		await page.getByTestId("move").click()
		await expect.poll(() => translateX(box)).toBeCloseTo(200, 0)
		// a derived value moved with it
		expect(await opacity(box)).toBeCloseTo(0.2, 1)
	})

	test("a spring lags its source rather than jumping", async ({page}) => {
		await openDemo(page, "values")
		const trailing = page.getByTestId("trailing")

		await page.getByTestId("move").click()
		// still catching up while the source has already arrived
		expect(await translateX(trailing)).toBeLessThan(200)
		await expect.poll(() => translateX(trailing)).toBeCloseTo(200, 0)
	})

	/*
	The point of holding each property in its own MotionValue: retargeting one
	no longer stops and replaces a single element-wide animation, which used to
	strand every other property wherever it had reached.
	*/
	test("retargeting one property leaves another mid-flight animation alone", async ({page}) => {
		await openDemo(page, "independent-properties")
		const box = page.getByTestId("box")

		await expect.poll(() => opacity(box)).toBeLessThan(0.9)
		await page.getByTestId("retarget").click()

		await expect.poll(() => translateX(box), {timeout: 4000}).toBeCloseTo(220, 0)
		// the fade carried on to its own target instead of freezing
		expect(await opacity(box)).toBeCloseTo(0.1, 1)
	})
})

test.describe("drag", () => {
	test("the element follows the pointer", async ({page}) => {
		await openDemo(page, "drag")
		const box = page.getByTestId("box")
		const start = (await box.boundingBox())!

		await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
		await page.mouse.down()
		await page.mouse.move(start.x + start.width / 2 + 80, start.y + start.height / 2 + 40, {
			steps: 8,
		})

		await expect.poll(() => translateX(box)).toBeCloseTo(80, 0)
		// the `dragging` layer is on while the pointer is held
		await expect.poll(() => opacity(box)).toBeCloseTo(0.5, 1)

		await page.mouse.up()
		await expect.poll(() => opacity(box)).toBeCloseTo(1, 1)
		expect(await translateX(box)).toBeCloseTo(80, 0)
	})

	test("constraints resist movement past the bound", async ({page}) => {
		await openDemo(page, "drag-constrained")
		const box = page.getByTestId("box")
		const start = (await box.boundingBox())!
		const originY = start.y + start.height / 2

		await page.mouse.move(start.x + start.width / 2, originY)
		await page.mouse.down()
		// 250 to the right of a 150 bound, with elastic 0.4
		await page.mouse.move(start.x + start.width / 2 + 250, originY, {steps: 10})

		await expect.poll(() => translateX(box)).toBeCloseTo(150 + 100 * 0.4, 0)
		await page.mouse.up()

		// and springs back to the bound once released
		await expect.poll(() => translateX(box)).toBeCloseTo(150, 0)
	})

	test("releasing with velocity carries the element on", async ({page}) => {
		await openDemo(page, "drag-momentum")
		const box = page.getByTestId("box")
		const start = (await box.boundingBox())!
		const originY = start.y + start.height / 2

		await page.mouse.move(start.x + start.width / 2, originY)
		await page.mouse.down()
		await page.mouse.move(start.x + start.width / 2 + 60, originY, {steps: 3})
		await page.mouse.up()

		// thrown past its release point, then settled back onto the bound
		await expect.poll(() => translateX(box), {timeout: 4000}).toBeCloseTo(120, 0)
	})
})

test.describe("layout", () => {
	/*
	FLIP: the row is already at its new layout position, held back by a
	transform that then animates away. So mid-animation it must be visibly
	offset from where it will end up.
	*/
	test("a reordered row animates to its new position", async ({page}) => {
		await openDemo(page, "layout")
		const first = page.getByTestId("item-1")

		const before = (await first.boundingBox())!.y
		await page.getByTestId("reorder").click()

		// caught mid-flight, still translated back towards where it was
		await expect.poll(() => translateY(first)).not.toBe(0)

		// and settles at the new position with no transform left over
		await expect.poll(() => translateY(first), {timeout: 4000}).toBe(0)
		expect((await first.boundingBox())!.y).toBeGreaterThan(before)
	})

	test("removing a row animates the ones below it up", async ({page}) => {
		await openDemo(page, "layout-removal")
		const second = page.getByTestId("item-2")

		const before = (await second.boundingBox())!.y
		await page.getByTestId("remove").click()

		// held at its old position by the layout offset, then released
		await expect.poll(() => translateY(second)).toBeGreaterThan(0)
		await expect.poll(() => translateY(second), {timeout: 4000}).toBe(0)
		expect((await second.boundingBox())!.y).toBeLessThan(before)
	})
})
