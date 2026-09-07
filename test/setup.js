/*
jsdom doesn't implement IntersectionObserver. This is a controllable stub:
`inView()` (used for the `inView` prop) can construct and register against it,
and tests can drive intersection changes by hand.

Every live instance is tracked in `IntersectionObserver.__instances`. Call
`IntersectionObserver.__trigger(entries)` to deliver entries to whichever
instance is observing each entry's target — entries are plain objects, so a
test only needs to supply the fields it cares about (`target`, `isIntersecting`).
*/
if (typeof globalThis.IntersectionObserver === "undefined") {
	class IntersectionObserverStub {
		constructor(callback, options) {
			this.callback = callback
			this.options = options ?? {}
			this.targets = new Set()
			IntersectionObserverStub.__instances.add(this)
		}
		observe(target) {
			this.targets.add(target)
		}
		unobserve(target) {
			this.targets.delete(target)
		}
		disconnect() {
			this.targets.clear()
			IntersectionObserverStub.__instances.delete(this)
		}
		takeRecords() {
			return []
		}
	}

	IntersectionObserverStub.__instances = new Set()

	/**
	 * Deliver `entries` to every observer watching their targets. Each entry is
	 * filled out into an IntersectionObserverEntry-shaped object first, so
	 * consumers (and assertions) see the real property set.
	 */
	IntersectionObserverStub.__trigger = entries => {
		const list = entries.map(entry => ({
			boundingClientRect: entry.target.getBoundingClientRect(),
			intersectionRatio: entry.isIntersecting ? 1 : 0,
			intersectionRect: entry.target.getBoundingClientRect(),
			isIntersecting: true,
			rootBounds: null,
			time: performance.now(),
			...entry,
		}))
		for (const observer of IntersectionObserverStub.__instances) {
			const mine = list.filter(entry => observer.targets.has(entry.target))
			if (mine.length > 0) observer.callback(mine, observer)
		}
	}

	globalThis.IntersectionObserver = IntersectionObserverStub
}
