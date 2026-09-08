import {frame} from "motion-dom"

import type {AnimationOptions} from "./types.js"

/*
Layout animation, by the FLIP method: remember where an element was, notice it
has moved, put it back with a transform, then animate that transform away.

Only *position* is animated — Motion calls this `layout="position"`. Animating a
size change means scaling the element, which stretches its text and its
children, and undoing that distortion needs a full projection tree that
counter-scales every descendant and corrects border radii. Translation has no
such problem: it is exact, and it composes with whatever else is animating.
*/

/** An axis a layout offset is applied on. */
type Offset = "translateX" | "translateY"

/** What a layout-animated element needs from the motion state that owns it. */
export interface LayoutHost {
	element: Element
	/**
	 * The offset currently applied on an axis. Deliberately a plain read: it
	 * runs on every check, and creating a MotionValue just to measure would
	 * write a `transform` onto every tracked element whether it ever moved or
	 * not.
	 */
	offset: (key: Offset) => number
	/** the transition to use, already resolved */
	transition: () => AnimationOptions | undefined
	/** puts the element back by `from`, then animates that offset away */
	apply: (key: Offset, from: number, transition: AnimationOptions) => void
}

interface Registration {
	host: LayoutHost
	/** the last known *layout* position, with any layout offset subtracted out */
	previous?: {left: number; top: number}
}

const registry = new Set<Registration>()
let scheduled = false

/** Movement below this is measurement noise, not a layout change. */
const THRESHOLD = 0.5

const DEFAULT_TRANSITION: AnimationOptions = {
	type: "spring",
	stiffness: 550,
	damping: 45,
	restDelta: 0.5,
} as AnimationOptions

/*
`translateX`/`translateY` rather than `x`/`y`: they are separate entries in the
transform Motion builds, so a layout offset composes with a user's own `x`
instead of fighting it for the same slot.
*/
function measure(registration: Registration): {left: number; top: number} | undefined {
	const {host} = registration
	const box = host.element.getBoundingClientRect()

	/*
	A `display: none` element measures as a zero box everywhere. That is the
	absence of a layout rather than a change of one, so it is skipped and the
	last real position kept: treating it as a move would animate a full offset
	on something invisible, then animate it back very visibly on the way in.
	*/
	if (box.width === 0 && box.height === 0) return undefined

	// subtract the offset we are applying, to recover the true layout position
	return {
		left: box.left - host.offset("translateX"),
		top: box.top - host.offset("translateY"),
	}
}

function check(): void {
	scheduled = false

	/*
	Every measurement first, then every write. Interleaving them would force a
	synchronous reflow per element — Motion's frame loop keeps the two apart
	for exactly this reason.
	*/
	const moved: {registration: Registration; dx: number; dy: number}[] = []

	for (const registration of registry) {
		const next = measure(registration)
		if (!next) continue

		const previous = registration.previous
		registration.previous = next
		if (!previous) continue

		const dx = previous.left - next.left
		const dy = previous.top - next.top
		if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) continue

		moved.push({registration, dx, dy})
	}

	for (const {registration, dx, dy} of moved) {
		const {host} = registration
		const transition = host.transition() ?? DEFAULT_TRANSITION

		/*
		Added to the offset already in play rather than replacing it, so a
		layout change landing mid-animation continues from where the element
		visually is instead of snapping back to where it started.
		*/
		if (Math.abs(dx) >= THRESHOLD)
			host.apply("translateX", host.offset("translateX") + dx, transition)
		if (Math.abs(dy) >= THRESHOLD)
			host.apply("translateY", host.offset("translateY") + dy, transition)
	}
}

/**
 * @internal Asks for a layout check on the next frame. Called whenever anything
 * that could move an element happens — a mount, an unmount, an options change —
 * and collapsed to one pass per frame.
 */
export function scheduleLayoutCheck(): void {
	if (scheduled || registry.size === 0) return
	scheduled = true
	frame.read(check)
}

/*
A reorder moves elements without mounting, unmounting or updating any of them,
so nothing in the library's own lifecycle would notice. Moving DOM nodes is a
childList mutation, though, which is exactly what this watches for.

Attribute changes are deliberately not observed: the layout animation writes a
transform on every frame, and observing that would feed straight back into
itself.
*/
let observer: MutationObserver | undefined

function watchDocument(): void {
	if (observer || typeof MutationObserver === "undefined") return
	observer = new MutationObserver(scheduleLayoutCheck)
	observer.observe(document.documentElement, {childList: true, subtree: true})
}

function unwatchDocument(): void {
	if (registry.size > 0) return
	observer?.disconnect()
	observer = undefined
}

/** @internal Starts tracking an element's layout position. */
export function registerLayout(host: LayoutHost): () => void {
	const registration: Registration = {host}
	registry.add(registration)
	watchDocument()
	// measured on the next frame, once the element has actually been laid out
	frame.read(() => {
		if (registry.has(registration)) registration.previous ??= measure(registration)
	})

	return () => {
		registry.delete(registration)
		unwatchDocument()
	}
}
