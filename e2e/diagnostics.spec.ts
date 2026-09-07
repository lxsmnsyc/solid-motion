import {expect, test} from "@playwright/test"

/*
Solid 2 reports reactivity mistakes as dev-mode console diagnostics rather than
as failures — an unowned effect, a flush that is a silent no-op, a top-level
prop read that will never update. None of those surface in jsdom or in an
assertion, so this walks every playground demo in a real dev build and fails on
any of them.

The demo list is scraped from the playground's own index page rather than
hard-coded, so a demo added later is covered without touching this file.
*/
test("no reactivity diagnostics in any demo", async ({page}) => {
	let current = "index"
	const diagnostics: string[] = []

	page.on("console", message => {
		const text = message.text()
		// diagnostics are prefixed with a SCREAMING_SNAKE code in brackets
		if (!/^\[[A-Z_]+]/.test(text) || text.includes("repair guide")) return
		diagnostics.push(`${current} — ${text}`)
	})

	await page.goto("/")
	const demos = await page
		.locator("ul.index a")
		.evaluateAll(links =>
			links.map(link => new URL((link as HTMLAnchorElement).href).searchParams.get("demo")!),
		)
	expect(demos.length).toBeGreaterThan(0)

	for (const demo of demos) {
		current = demo
		await page.goto(`/?demo=${demo}`)
		await expect(page.getByTestId("unknown-demo")).toHaveCount(0)

		// drive whatever controls the demo exposes, so teardown paths run too
		for (const id of ["toggle", "swap", "fade"]) {
			const control = page.getByTestId(id)
			if (await control.count()) {
				await control.click()
				await page.waitForTimeout(300)
			}
		}
	}

	expect(diagnostics).toEqual([])
})
