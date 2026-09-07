import {scrollInfo} from "framer-motion/dom"
import {isServer} from "@solidjs/web"

import {createMotionState, createStyles, MotionState, StartStyles, style} from "./engine.js"
import {Accessor, createEffect, createSignal, flush, onCleanup, untrack} from "solid-js"

import {PresenceContext, PresenceContextState, tryUseContext} from "./presence.jsx"
import {MotionConfigContext} from "./config.jsx"
import {Options} from "./types.js"

/** @internal */
export function createAndBindMotionState(
	el: () => Element,
	raw_options: Accessor<Options>,
	presence_state?: PresenceContextState,
	parent_state?: MotionState,
	/* the tag being rendered, so an SVG start target is built as attributes */
	tag = "div",
): [MotionState, StartStyles] {
	/*
	Applied here rather than in the Motion component so every entry point —
	`<Motion>`, `motion()` and `createMotion()` — inherits a `<MotionConfig>`
	the same way. Element-level options always win over the config.
	*/
	const config = tryUseContext(MotionConfigContext)
	const options: Accessor<Options> = config
		? () => {
				const own = raw_options()
				return {
					...own,
					transition: own.transition ?? config.transition,
					reducedMotion: own.reducedMotion ?? config.reducedMotion,
				}
			}
		: raw_options

	/*
	The initial snapshot is deliberately a one-time read: `createMotionState`
	stores it, and every later change arrives through the `update()` effect
	below. Tracking it here would subscribe the component body itself
	(STRICT_READ_UNTRACKED) to props that are already handled reactively.
	*/
	const state = untrack(() =>
		createMotionState(
			presence_state?.initial === false ? {...options(), initial: false} : options(),
			parent_state,
		),
	)

	/*
	Motion components under <Presence exitBeforeEnter> should wait before animating in
	this is done with additional signal, because effects will still run immediately
	*/
	createEffect(
		() => (presence_state ? presence_state.mount() : true),
		shouldMount => {
			if (!shouldMount) return

			const el_ref = el()
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `el_ref` is typed non-nullable, but see the comment below for why this still needs a runtime check
			if (!el_ref) {
				/*
				The ref is assigned synchronously during render, before any effect
				fires, so reaching here means this component's JSX was never
				rendered at all. Two known causes, and the message names both
				because the first one used to be reported as the second:

				1. Several element children passed straight to
				   <Presence exitBeforeEnter>. That mode transitions one element
				   at a time and only ever resolves the first, so later siblings
				   are constructed but never inserted. (A plain <Presence>
				   renders them all.)
				2. Two copies of solid-js in the app (a linked or duplicated
				   dependency), leaving this component's effects on a different
				   reactive graph than the one that set the ref. See
				   https://github.com/solidjs-community/solid-motionone/issues/10
				*/
				/*
				Warn rather than throw: an uncaught error here halts Solid's
				reactive system for the entire app (REACTIVITY_HALTED, "no
				further updates will be processed"), which is a wildly
				disproportionate response to one mis-nested child. There is
				nothing to animate without an element, so skip this mount and
				let the rest of the page keep working.
				*/
				// eslint-disable-next-line no-console -- a silent no-op here is undebuggable
				console.warn(
					"solid-motion: element ref was not set before mount, so this Motion was " +
						"never rendered and will not animate. If it is one of several children " +
						"passed directly to <Presence exitBeforeEnter>, wrap them in a single " +
						"parent element — that mode only renders the first child. Otherwise " +
						"check for duplicate or mismatched copies of solid-js (e.g. with " +
						"`npm ls solid-js`).",
				)
				return
			}
			const unmount = state.mount(el_ref)

			return () => {
				// an effect's cleanup runs untracked; this asks what `exit` is *now*,
				// and must not try to subscribe to it on the way out
				if (presence_state && untrack(() => options().exit)) {
					const exiting = state.startExit()
					if (exiting) {
						/*
						Hand the running exit to the enclosing Presence before
						returning: this cleanup runs during Solid's disposal pass,
						which completes before the render effect that invokes
						Presence's own `onExit` — so by the time it looks for
						pending exits in this subtree, ours is already there.
						*/
						presence_state.exits?.retain(el_ref, exiting)
						void exiting.then(unmount)
						return
					}
				}
				unmount()
			}
		},
	)

	createEffect(
		() => (presence_state && !presence_state.mount() ? undefined : options()),
		opts => {
			if (opts) state.update(opts)
		},
	)

	return [state, createStyles(state.getTarget(), tag)] as const
}

/**
 * createMotion provides MotionOne as a compact Solid primitive.
 *
 * @param target Target Element to animate.
 * @param options Options to effect the animation.
 * @param presenceState Optional PresenceContext override, defaults to current parent.
 * @returns Object to access MotionState
 */
export function createMotion(
	target: Element,
	options: Accessor<Options> | Options,
	presenceState?: PresenceContextState,
): MotionState {
	const [state, styles] = createAndBindMotionState(
		() => target,
		typeof options === "function" ? options : () => options,
		presenceState,
		undefined,
		target.tagName.toLowerCase(),
	)

	for (const key in styles.style) {
		style.set(target, key, styles.style[key])
	}
	for (const key in styles.attrs) {
		target.setAttribute(key, String(styles.attrs[key]))
	}

	return state
}

/**
 * motion is a ref factory that makes binding to elements easier.
 *
 * @param options Options to effect the animation.
 * @returns A ref callback to pass to an element's `ref` prop.
 *
 * @example
 * ```tsx
 * <div ref={motion(() => ({ animate: { opacity: 1 } }))} />
 * ```
 */
export function motion(options: Accessor<Options>): (el: Element) => void {
	const presence_state = tryUseContext(PresenceContext)

	/*
	A two-phase directive factory, which is the shape Solid 2 prescribes for
	refs:

	- Setup (here) is owned by whichever component called the factory, and is
	  where every reactive primitive is created — so they are disposed with it.
	  Solid invokes a ref callback with *no* owner, so creating them in there
	  would leave them undisposed (NO_OWNER_EFFECT): gestures would stay bound
	  after the element was gone, its entry would linger in `mountedStates`,
	  and an in-flight animation would never be cancelled.
	- Apply (the returned callback) is unowned and only writes to the DOM.

	The mount effect created below runs after the render phase, by which point
	the ref has already assigned `element`.
	*/
	let element: Element | undefined
	const [state] = createAndBindMotionState(() => element!, options, presence_state)

	return el => {
		element = el
		/*
		The start target can only be built here: the element's tag decides
		whether SVG geometry is written as attributes or as styles, and the tag
		isn't knowable until the ref fires.
		*/
		const {style: styles, attrs} = createStyles(state.getTarget(), el.tagName.toLowerCase())
		for (const key in styles) style.set(el, key, styles[key])
		for (const key in attrs) el.setAttribute(key, String(attrs[key]))
	}
}

/*
`AxisScrollInfo`/`ScrollInfoOptions` aren't part of framer-motion/dom's public
export list (only the `scroll`/`scrollInfo` functions themselves are), so
derive them structurally from `scrollInfo`'s own signature instead.
*/
type ScrollInfoOptions = Parameters<typeof scrollInfo>[1]
type AxisScrollInfo = Parameters<Parameters<typeof scrollInfo>[0]>[0]["x"]

const emptyAxisScrollInfo = (): AxisScrollInfo => ({
	current: 0,
	offset: [],
	progress: 0,
	scrollLength: 0,
	velocity: 0,
	targetOffset: 0,
	targetLength: 0,
	containerLength: 0,
})

/**
 * useScroll provides reactive scroll progress values, based on Motion's
 * [`scrollInfo`](https://motion.dev/docs/scroll) function.
 *
 * @param options Options controlling which element/axis/offsets are tracked.
 * @returns Reactive accessors for the current scroll time and per-axis info.
 *
 * @example
 * ```tsx
 * const {scrollY} = useScroll()
 * createEffect(() => console.log(scrollY().progress))
 * ```
 */
export function useScroll(options?: ScrollInfoOptions): {
	time: Accessor<number>
	scrollX: Accessor<AxisScrollInfo>
	scrollY: Accessor<AxisScrollInfo>
} {
	const [time, setTime] = createSignal(0)
	const [scrollX, setScrollX] = createSignal<AxisScrollInfo>(emptyAxisScrollInfo())
	const [scrollY, setScrollY] = createSignal<AxisScrollInfo>(emptyAxisScrollInfo())

	/*
	No reactive dependency to track here, so this is a one-shot side effect —
	Solid 2.0's createEffect now requires both a compute and effect function,
	and its own error for this case says to just call directly instead. Since
	that skips the "effects don't run during SSR" guarantee that normally keeps
	DOM-only code out of the server build, guard explicitly with isServer.
	*/
	if (!isServer) {
		onCleanup(
			scrollInfo(info => {
				/*
				scrollInfo's callback fires from Motion's own rAF-driven scheduler,
				entirely outside Solid's, so these writes run inside an explicit
				synchronous flush scope — otherwise a frame's worth of scroll
				values would sit pending until some unrelated flush drained them.

				info.x/info.y are also reused/mutated in place across frames by
				Motion internally, so they're shallow-copied here — writing the
				same object reference into a signal would never trip Solid's
				Object.is equality check and the signal would look unchanged.
				*/
				flush(() => {
					setTime(info.time)
					setScrollX({...info.x})
					setScrollY({...info.y})
				})
			}, options),
		)
	}

	return {time, scrollX, scrollY}
}
