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
 * Waits until an element's animations have finished, then returns the computed
 * value of `property`. Avoids sleeping for a fixed duration, which is flaky
 * across the three browser engines.
 */
export async function settled(locator: Locator, property = "opacity"): Promise<string> {
	/*
	Ask the browser rather than sampling. `motion-dom` runs opacity and
	transform through the Web Animations API, so in a real browser they are
	driven on the compositor — and WebKit does not tick `getComputedStyle` in
	lockstep with a compositor-driven animation. Two equal reads there prove
	nothing, which is exactly how a mid-flight value gets mistaken for a
	settled one.

	Bounded, because draining one animation can reveal its replacement: the
	engine stops the previous controls on every retarget.
	*/
	for (let i = 0; i < 20; i++) {
		const idle = await locator.evaluate(async el => {
			// two frames, so an animation the last action triggered has been
			// registered by the time we look for it
			await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
			await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

			const running = el.getAnimations()
			if (running.length === 0) return true
			// `finished` rejects when Motion cancels an animation to retarget,
			// which is an ordinary outcome here rather than a failure
			await Promise.all(running.map(animation => animation.finished.catch(() => undefined)))
			return false
		})
		if (idle) break
	}

	/*
	Values Motion drives on its own rAF loop instead of through WAAPI —
	anything bound to a `MotionValue` — leave nothing for `getAnimations` to
	report, so they still need sampling. Two matching pairs rather than one:
	a single pair can straddle a frame the value happened not to change on.
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
