import {
	animateSingleValue,
	isElementTextInput,
	isPrimaryPointer,
	setDragLock,
	type MotionValue,
} from "motion-dom"

import type {DragAxis, DragConstraints, Options} from "./types.js"

/** The axes a `drag` prop enables. */
function axesOf(drag: DragAxis | undefined): ("x" | "y")[] {
	if (!drag) return []
	if (drag === "x" || drag === "y") return [drag]
	return ["x", "y"]
}

/*
`dragConstraints` are expressed relative to where the element started, which is
exactly what the `x`/`y` values already measure — so a constraint box maps
straight onto a min/max per axis.
*/
function boundsFor(
	axis: "x" | "y",
	constraints: DragConstraints | undefined,
): {min?: number; max?: number} {
	if (!constraints) return {}
	return axis === "x"
		? {min: constraints.left, max: constraints.right}
		: {min: constraints.top, max: constraints.bottom}
}

/**
 * Resists movement past a bound instead of stopping dead at it, so the element
 * still follows the pointer — just reluctantly. `elastic` of 0 pins it to the
 * bound, 1 ignores the bound entirely.
 */
function applyConstraints(
	value: number,
	{min, max}: {min?: number; max?: number},
	elastic: number,
): number {
	if (min !== undefined && value < min) return min + (value - min) * elastic
	if (max !== undefined && value > max) return max + (value - max) * elastic
	return value
}

/** What a drag session needs from the motion state that owns the element. */
export interface DragHost {
	element: Element
	/** the MotionValue driving an axis, created on demand */
	value(axis: "x" | "y"): MotionValue<number>
	options(): Options
	/** turns the `dragging` layer on and off */
	setDragging(active: boolean): void
	dispatch(type: string, detail: Record<string, unknown>): void
}

/** Movement, in pixels, before a press is treated as a drag rather than a click. */
const DRAG_THRESHOLD = 3

/**
 * @internal Binds a pointer-driven drag to an element, writing straight to its
 * `x`/`y` MotionValues.
 */
export function bindDrag(host: DragHost): () => void {
	const el = host.element as HTMLElement

	/*
	Without this a touch drag scrolls the page instead, and a pointer drag
	across text selects it. `pan-y`/`pan-x` keeps the perpendicular scroll
	direction usable when only one axis is draggable.
	*/
	const previousTouchAction = el.style.touchAction
	const previousUserSelect = el.style.userSelect
	const axes = axesOf(host.options().drag)
	el.style.touchAction = axes.length === 2 ? "none" : axes[0] === "x" ? "pan-y" : "pan-x"
	el.style.userSelect = "none"

	let session:
		| {
				pointerId: number
				origin: {x: number; y: number}
				axes: ("x" | "y")[]
				releaseLock: () => void
				/** where the values sat when the drag actually began, once past the threshold */
				start?: {x: number; y: number}
		  }
		| undefined

	const offsetOf = (event: PointerEvent): {x: number; y: number} => ({
		x: event.clientX - session!.origin.x,
		y: event.clientY - session!.origin.y,
	})

	const onPointerDown = (event: PointerEvent): void => {
		if (session || !isPrimaryPointer(event)) return

		const {drag} = host.options()
		const dragAxes = axesOf(drag)
		if (dragAxes.length === 0) return

		/*
		One drag at a time across the whole page: a nested draggable would
		otherwise move together with its draggable ancestor.
		*/
		const releaseLock = setDragLock(drag!)
		if (!releaseLock) return

		/*
		Stops the browser starting a native drag-and-drop on any image or text
		inside, which would hijack the pointer. Skipped for text inputs, where
		it would break selection and caret placement.
		*/
		if (!isElementTextInput(event.target as Element)) event.preventDefault()

		session = {
			pointerId: event.pointerId,
			origin: {x: event.clientX, y: event.clientY},
			axes: dragAxes,
			releaseLock,
		}

		window.addEventListener("pointermove", onPointerMove)
		window.addEventListener("pointerup", onPointerUp)
		window.addEventListener("pointercancel", onPointerUp)
	}

	const onPointerMove = (event: PointerEvent): void => {
		if (!session || event.pointerId !== session.pointerId) return

		const offset = offsetOf(event)
		if (!session.start) {
			// a press that never really moves stays a press, so buttons still click
			if (Math.abs(offset.x) < DRAG_THRESHOLD && Math.abs(offset.y) < DRAG_THRESHOLD) return

			/*
			The values are only read — and so only created and bound — once the
			drag is real. Reading them on pointerdown would write a `transform`
			onto every element anyone merely clicked.
			*/
			session.start = {x: host.value("x").get(), y: host.value("y").get()}
			host.setDragging(true)
			host.dispatch("dragstart", {originalEvent: event, offset})
		}

		const {dragConstraints, dragElastic = 0.5} = host.options()
		const elastic = dragElastic === true ? 0.5 : dragElastic === false ? 0 : dragElastic

		for (const axis of session.axes) {
			const next = session.start[axis] + offset[axis]
			host.value(axis).set(applyConstraints(next, boundsFor(axis, dragConstraints), elastic))
		}

		host.dispatch("drag", {originalEvent: event, offset})
	}

	const onPointerUp = (event: PointerEvent): void => {
		if (!session || event.pointerId !== session.pointerId) return

		const started = session.start !== undefined
		const sessionAxes = session.axes
		const offset = offsetOf(event)
		session.releaseLock()
		session = undefined

		window.removeEventListener("pointermove", onPointerMove)
		window.removeEventListener("pointerup", onPointerUp)
		window.removeEventListener("pointercancel", onPointerUp)

		if (!started) return

		const {dragConstraints, dragMomentum = true, dragTransition} = host.options()

		for (const axis of sessionAxes) {
			const value = host.value(axis)
			const bounds = boundsFor(axis, dragConstraints)

			/*
			`inertia` reads its origin from the first keyframe and projects a
			target from the release velocity, so the keyframes are the current
			position alone — there is no known destination to animate towards.
			Out-of-bounds values spring back to the nearest bound.
			*/
			animateSingleValue(
				value,
				[value.get()] as never,
				{
					type: "inertia",
					velocity: dragMomentum ? value.getVelocity() : 0,
					...bounds,
					...dragTransition,
				} as never,
			)
		}

		host.setDragging(false)
		host.dispatch("dragend", {originalEvent: event, offset})
	}

	el.addEventListener("pointerdown", onPointerDown)

	return () => {
		session?.releaseLock()
		session = undefined
		el.removeEventListener("pointerdown", onPointerDown)
		window.removeEventListener("pointermove", onPointerMove)
		window.removeEventListener("pointerup", onPointerUp)
		window.removeEventListener("pointercancel", onPointerUp)
		el.style.touchAction = previousTouchAction
		el.style.userSelect = previousUserSelect
	}
}
