import {mapValue, motionValue, springValue, transformValue, type MotionValue} from "motion-dom"
import {getOwner, onCleanup} from "solid-js"
import type {MapInputRange, SpringOptions, TransformOptions} from "motion-dom"

export type {MotionValue}

/*
A MotionValue is a single animatable number or string that lives outside
Solid's graph. It is not a signal: writing to one does not schedule a render,
and reading one does not subscribe. That is the point — a value driven at
60fps by scroll or a spring would otherwise re-run every computation that
touched it, once per frame.

Bind one to an element by putting it in a `style` prop, and Motion writes it
straight to the DOM on its own frame loop.
*/

/** Ties a derived value's subscriptions to the calling owner, when there is one. */
function owned<T extends MotionValue>(value: T): T {
	// `motion()`-style factories may be called with no owner; nothing to tie to
	if (getOwner()) onCleanup(() => value.destroy())
	return value
}

/**
 * Creates a `MotionValue`: a value that can be animated and bound to an
 * element's style without going through Solid's reactive graph.
 *
 * @example
 * ```tsx
 * const x = createMotionValue(0)
 * <Motion.div style={{x}} onClick={() => x.set(100)} />
 * ```
 */
export function createMotionValue<V>(initial: V): MotionValue<V> {
	return owned(motionValue(initial))
}

/**
 * Derives a `MotionValue` from others — the equivalent of Motion's
 * `useTransform`.
 *
 * Either map one value from an input range onto an output range, or compute
 * one from any number of values with a function. The function form re-runs
 * whenever a value it reads changes.
 *
 * @example
 * ```tsx
 * const {scrollY} = useScroll()
 * const opacity = createTransform(progress, [0, 1], [0, 1])
 * const label = createTransform(() => `${Math.round(x.get())}px`)
 * ```
 */
export function createTransform<O>(compute: () => O): MotionValue<O>
export function createTransform<O>(
	value: MotionValue<number>,
	inputRange: MapInputRange,
	outputRange: O[],
	options?: TransformOptions<O>,
): MotionValue<O>
export function createTransform<O>(
	computeOrValue: (() => O) | MotionValue<number>,
	inputRange?: MapInputRange,
	outputRange?: O[],
	options?: TransformOptions<O>,
): MotionValue<O> {
	return owned(
		typeof computeOrValue === "function"
			? transformValue(computeOrValue)
			: mapValue(computeOrValue, inputRange!, outputRange!, options),
	)
}

/**
 * Follows another value (or a plain number) with spring physics — the
 * equivalent of Motion's `useSpring`. Useful for smoothing a value that jumps,
 * such as pointer position or scroll progress.
 *
 * @example
 * ```tsx
 * const {scrollY} = useScroll()
 * const smooth = createSpring(progress, {stiffness: 120, damping: 20})
 * ```
 */
export function createSpring<T extends string | number>(
	source: T | MotionValue<T>,
	options?: SpringOptions,
): MotionValue<T> {
	return owned(springValue(source, options))
}
