import {expect, type Locator, type Page} from "@playwright/test"

/** Navigates to one playground demo. */
export async function openDemo(page: Page, id: string): Promise<void> {
	await page.goto(`/?demo=${id}`)
	await expect(page.getByTestId("unknown-demo")).toHaveCount(0)
}

/**
 * Reads a resolved style value off an element. Unlike the inline `style`
 * attribute the unit tests assert on, this is what the browser actually
 * computed, so it reflects a running animation.
 */
export function computed(locator: Locator, property: string): Promise<string> {
	return locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property)
}

/** Resolved opacity as a number, for range assertions during an animation. */
export async function opacity(locator: Locator): Promise<number> {
	return Number(await computed(locator, "opacity"))
}

/**
 * Waits until an element's animated property stops changing, then returns it.
 * Avoids sleeping for a fixed duration, which is flaky across the three
 * browser engines.
 */
export async function settled(locator: Locator, property = "opacity"): Promise<string> {
	/*
	Let Motion's frame loop apply the first frame of whatever the last action
	triggered, so the sampling below cannot open on a pre-start value and
	mistake it for a resting one.
	*/
	await locator.evaluate(async () => {
		await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
		await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
	})

	/*
	Sampling, rather than awaiting `el.getAnimations()`, because there is
	nothing there to await: this engine drives its animations on Motion's own
	rAF loop and writes inline styles, so `getAnimations()` reports zero on
	every frame of a running animation. Measured, not assumed.

	Two matching pairs rather than one. One pair is what made this flaky: two
	consecutive reads can land either side of a frame the value happened not
	to change on, and a mid-flight value then passes as a settled one.
	*/
	let previous = await computed(locator, property)
	let matches = 0
	for (let i = 0; i < 60; i++) {
		await locator.page().waitForTimeout(50)
		const next = await computed(locator, property)
		if (next !== previous) matches = 0
		else if (++matches > 1) return next
		previous = next
	}
	throw new Error(`"${property}" never settled (last value ${previous})`)
}

/** The uniform scale factor of an element's computed transform. */
export async function scaleOf(locator: Locator): Promise<number> {
	const transform = await computed(locator, "transform")
	if (transform === "none") return 1
	const values = transform.match(/matrix\(([^)]+)\)/)?.[1]?.split(",")
	return Number(values?.[0] ?? 1)
}

/** The vertical translation of an element's computed transform, in pixels. */
export async function translateY(locator: Locator): Promise<number> {
	const transform = await computed(locator, "transform")
	if (transform === "none") return 0
	const values = transform.match(/matrix\(([^)]+)\)/)?.[1]?.split(",")
	return Number(values?.[5] ?? 0)
}

/** The horizontal translation of an element's computed transform, in pixels. */
export async function translateX(locator: Locator): Promise<number> {
	const transform = await computed(locator, "transform")
	if (transform === "none") return 0
	const values = transform.match(/matrix\(([^)]+)\)/)?.[1]?.split(",")
	return Number(values?.[4] ?? 0)
}
