import {animate} from "framer-motion/dom"
import {inView as motionInView} from "framer-motion/dom"
import {
	hover,
	press,
	buildHTMLStyles,
	camelToDash,
	readTransformValue,
	transformProps,
} from "motion-dom"
import type {AnimationOptions} from "motion-dom"

import type {Options, Target, VariantDefinition} from "./types.js"

/** @internal */
export const mountedStates = new WeakMap<Element, MotionState>()

/** @internal */
export interface MotionState {
	mount(el: Element): () => void
	update(options: Options): void
	/**
	 * @internal Begins the exit animation, returning a promise that settles once
	 * it has actually finished — or `null` when `exit` resolves to nothing
	 * animatable, so the caller can unmount synchronously instead of waiting a
	 * microtask on an already-resolved promise.
	 */
	startExit(): Promise<void> | null
	getTarget(): Target
	getOptions(): Options
	/** @internal the resolved `initial` variant key, inherited from a parent Motion if unset here */
	getInitialVariantKey(): string | undefined
}

function resolveTarget(
	def: VariantDefinition | undefined,
	variants: Record<string, Target> | undefined,
): Target | undefined {
	if (def === undefined) return undefined
	return typeof def === "string" ? variants?.[def] : def
}

/*
Two compatibility shims for the documented `transition={{duration, key: {...}}}`
per-value override syntax:

1. Motion One used `easing`; modern Motion renamed it to `ease`.
2. Motion One's per-value override only needed to specify what differs from
   the base transition (the rest was inherited). Modern Motion's own
   `resolveTransition` only merges a per-value override with its parent when
   the override explicitly sets `inherit: true` — otherwise the override is
   used standalone and silently falls back to Motion's own defaults for
   anything it didn't specify (e.g. `x: {offset: [...]}` with no `duration`
   of its own completes almost instantly instead of over the base duration).
   Merging here keeps the documented, more ergonomic behavior working.
*/
function normalizeTransition(transition: unknown): AnimationOptions | undefined {
	if (!transition || typeof transition !== "object")
		return transition as AnimationOptions | undefined

	const base: Record<string, unknown> = {}
	const perValue: Record<string, Record<string, unknown>> = {}
	for (const [key, value] of Object.entries(transition)) {
		if (value && typeof value === "object" && !Array.isArray(value)) perValue[key] = value
		else base[key === "easing" ? "ease" : key] = value
	}

	const result: Record<string, unknown> = {...base}
	for (const [key, override] of Object.entries(perValue)) {
		const normalizedOverride = {...base}
		for (const [k, v] of Object.entries(override))
			normalizedOverride[k === "easing" ? "ease" : k] = v
		result[key] = normalizedOverride
	}
	return result as AnimationOptions
}

function targetValues(target: Target | undefined): Record<string, unknown> {
	if (!target) return {}
	const {transition: _transition, ...values} = target
	return values
}

/** @internal */
export function createStyles(target: Target): Record<string, string> {
	const renderState = {transform: {}, transformOrigin: {}, vars: {}, style: {}}
	// a static (non-animated) style can't represent a keyframe list — use its first value
	const staticValues: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(targetValues(target))) {
		staticValues[key] = Array.isArray(value) ? value[0] : value
	}
	buildHTMLStyles(renderState as any, staticValues as any)
	return {...(renderState.vars as any), ...(renderState.style as any)}
}

/** @internal */
export const style = {
	set(el: Element, key: string, value: unknown): void {
		if (key.startsWith("--")) (el as HTMLElement).style.setProperty(key, String(value))
		else (el as HTMLElement).style[key as any] = value as string
	},
}

function applyStylesDirect(el: Element, target: Target): void {
	const styles = createStyles(target)
	for (const key in styles) style.set(el, key, styles[key])
}

function dispatch(el: Element, type: string, detail: Record<string, unknown>): void {
	el.dispatchEvent(new CustomEvent(type, {detail}))
}

interface MountContext {
	element: Element
	cancelAnimation?: () => void
	unbindGestures?: () => void
	/** resolves the latch handed out by `startExit()` — see there for why it isn't the animation's own promise */
	resolveExit?: () => void
}

/** @internal */
export function createMotionState(initialOptions: Options, parent?: MotionState): MotionState {
	let options = initialOptions
	const active = {hover: false, press: false, inView: false, exit: false}

	/*
	Scoped to whichever mount() call is currently active. A sibling Motion
	component can get constructed — and briefly mounted/unmounted again —
	before its real mount, as a structural side effect of how <Show>/
	createSwitchTransition read reactive sources (see primitives.ts's
	mount-gating effect). That stale cycle's own cleanup must never reach
	into a *newer* mount's in-flight animation or gesture bindings and
	cancel them; keeping this per-mount-context, and only ever pointing
	`current` at the latest one, keeps the two cycles from interfering.
	*/
	let current: MountContext | undefined

	function getInitialVariantKey(): string | undefined {
		if (typeof options.initial === "string") return options.initial
		if (options.initial === undefined) return parent?.getInitialVariantKey()
		return undefined
	}

	function getStartTarget(): Target {
		if (options.initial === false) {
			return resolveTarget(options.animate, options.variants) ?? {}
		}
		if (options.initial === undefined) {
			/*
			No explicit `initial` and nothing inherited from a parent's variant
			key: leave the starting style empty (browser defaults) rather than
			falling back to the `animate` target. Falling back to `animate` here
			made mount()'s "does the start differ from the target" check always
			see them as equal, silently skipping the enter animation entirely —
			breaking the documented default behavior ("elements automatically
			animate to the values defined in animate when they're created").
			*/
			const inheritedKey = getInitialVariantKey()
			return (inheritedKey && options.variants?.[inheritedKey]) || {}
		}
		return resolveTarget(options.initial, options.variants) ?? {}
	}

	/*
	Resting values for keys that *only* a gesture layer introduces. Without an
	`animate` prop to fall back to, ending a gesture computes an empty target,
	`animateToTarget` short-circuits, and the element stays stuck in its
	hovered/pressed state forever.

	Recorded lazily, keyed once and never re-read: the first computation happens
	from a gesture's start handler, before that gesture's own animation is
	started, so whatever is read off the element here is genuinely its rest
	state. `undefined` is recorded (and skipped when filling) for keys with no
	readable value, so the element is only measured once either way.
	*/
	const restValues: Record<string, unknown> = {}

	function readRestValue(el: Element, key: string): unknown {
		// transforms aren't readable as plain style properties — they have to be
		// parsed back out of the computed matrix, which falls back to the
		// property's own identity value (1 for scales, 0 otherwise) when unset
		if (transformProps.has(key)) return readTransformValue(el as HTMLElement, key)

		// targets may be written camelCase or kebab-case; getPropertyValue only
		// understands the latter (and leaves `--custom-props` alone)
		const value = getComputedStyle(el).getPropertyValue(camelToDash(key))
		return value === "" ? undefined : value
	}

	function recordRestValues(el: Element): void {
		const base = resolveTarget(options.animate, options.variants)
		let start: Target | undefined

		for (const layer of [options.hover, options.press, options.inView]) {
			const target = resolveTarget(layer, options.variants)
			if (!target) continue

			for (const key of Object.keys(target)) {
				if (key === "transition" || key in restValues) continue

				const animated = base?.[key as keyof Target]
				if (animated !== undefined) {
					// where the base layer's own animation lands
					restValues[key] = Array.isArray(animated) ? animated.at(-1) : animated
					continue
				}

				start ??= getStartTarget()
				const initial = start[key as keyof Target]
				if (initial !== undefined) {
					// what `initial` statically applied — see createStyles()
					restValues[key] = Array.isArray(initial) ? initial[0] : initial
					continue
				}

				restValues[key] = readRestValue(el, key)
			}
		}
	}

	// layered lowest-priority first: animate -> inView -> hover -> press
	function computeEffectiveTarget(): Target {
		if (active.exit) return resolveTarget(options.exit, options.variants) ?? {}

		if (current) recordRestValues(current.element)

		const target: Target = {...(resolveTarget(options.animate, options.variants) ?? {})}
		if (active.inView) Object.assign(target, resolveTarget(options.inView, options.variants))
		if (active.hover) Object.assign(target, resolveTarget(options.hover, options.variants))
		if (active.press) Object.assign(target, resolveTarget(options.press, options.variants))

		for (const key in restValues) {
			if (restValues[key] !== undefined && !(key in target))
				(target as Record<string, unknown>)[key] = restValues[key]
		}
		return target
	}

	function animateToTarget(target: Target, isExit = false): Promise<void> {
		const ctx = current
		ctx?.cancelAnimation?.()
		if (!ctx) return Promise.resolve()
		const values = targetValues(target)
		if (Object.keys(values).length === 0) return Promise.resolve()

		// merge, then normalize once — normalizing an already-normalized base
		// transition again would re-merge its own per-value overrides against a
		// *new* base and let stale, already-baked-in override values win
		const transition = normalizeTransition({...options.transition, ...target.transition})
		dispatch(ctx.element, "motionstart", {target})
		const controls = animate(ctx.element, values as any, transition as any)
		ctx.cancelAnimation = () => controls.stop()
		/*
		Only a *completed* animation reaches the fulfilment arm: Motion leaves
		`finished` permanently pending on a stopped or cancelled animation
		(it neither resolves nor rejects), which is exactly why the exit latch
		below can't just be `controls.finished` itself. The rejection arm is
		kept as a guard against a future version choosing to reject instead.
		*/
		return controls.finished.then(
			() => {
				// don't dispatch on behalf of a mount cycle a newer one has superseded
				if (current !== ctx) return
				dispatch(ctx.element, "motioncomplete", {target})
				// only the exit animation itself releases the latch, so a gesture
				// or `animate` change that happens to land while `active.exit` is
				// already set can't cut the exit short
				if (isExit) {
					const resolve = ctx.resolveExit
					ctx.resolveExit = undefined
					resolve?.()
				}
			},
			() => undefined,
		)
	}

	function bindGestures(el: Element): () => void {
		const unbinds: Array<() => void> = []
		if (options.hover) {
			unbinds.push(
				hover(el, (_el, startEvent) => {
					active.hover = true
					dispatch(el, "hoverstart", {originalEvent: startEvent})
					void animateToTarget(computeEffectiveTarget())
					return endEvent => {
						active.hover = false
						dispatch(el, "hoverend", {originalEvent: endEvent})
						void animateToTarget(computeEffectiveTarget())
					}
				}),
			)
		}
		if (options.press) {
			unbinds.push(
				press(el, (_el, startEvent) => {
					active.press = true
					dispatch(el, "pressstart", {originalEvent: startEvent})
					void animateToTarget(computeEffectiveTarget())
					return endEvent => {
						active.press = false
						dispatch(el, "pressend", {originalEvent: endEvent})
						void animateToTarget(computeEffectiveTarget())
					}
				}),
			)
		}
		if (options.inView) {
			unbinds.push(
				motionInView(
					el,
					// `inView`'s start callback is `(element, entry)`, unlike
					// hover/press whose second argument is the originating event
					(_el, entry) => {
						active.inView = true
						dispatch(el, "viewenter", {originalEntry: entry})
						void animateToTarget(computeEffectiveTarget())
						return leaveEntry => {
							active.inView = false
							dispatch(el, "viewleave", {originalEntry: leaveEntry})
							void animateToTarget(computeEffectiveTarget())
						}
					},
					options.inViewOptions as any,
				),
			)
		}
		return () => unbinds.forEach(unbind => unbind())
	}

	const state: MotionState = {
		mount(el: Element) {
			/*
			`active` is scoped to the state, which outlives any single mount, so
			a fresh mount must not inherit the previous cycle's flags — a stale
			`hover: true` would otherwise keep layering the hover target onto
			every subsequent target computation.
			*/
			const stranded = current?.resolveExit
			active.hover = active.press = active.inView = active.exit = false

			const ctx: MountContext = {element: el}
			current = ctx

			/*
			Whatever exit the superseded cycle was running can never complete now
			(`animateToTarget` only settles the latch while its own context is
			still `current`), so release its waiter rather than pinning the old
			element in the DOM forever.
			*/
			stranded?.()

			const startTarget = getStartTarget()
			applyStylesDirect(el, startTarget)

			const animateTarget = resolveTarget(options.animate, options.variants) ?? {}
			if (
				JSON.stringify(targetValues(startTarget)) !==
				JSON.stringify(targetValues(animateTarget))
			) {
				void animateToTarget(animateTarget)
			}

			ctx.unbindGestures = bindGestures(el)
			mountedStates.set(el, state)

			return () => {
				ctx.cancelAnimation?.()
				ctx.unbindGestures?.()
				mountedStates.delete(el)
				if (current === ctx) current = undefined
			}
		},
		update(newOptions: Options) {
			const prevOptions = options
			const prevAnimate = JSON.stringify(
				resolveTarget(prevOptions.animate, prevOptions.variants) ?? {},
			)
			options = newOptions

			// only tear down and recreate gesture listeners when a gesture-related
			// prop actually changed — not on every unrelated reactive update (e.g.
			// a reactive `animate` value), which would cut off an in-progress
			// hover/press/inView interaction for no reason
			const gesturesChanged =
				prevOptions.hover !== options.hover ||
				prevOptions.press !== options.press ||
				prevOptions.inView !== options.inView ||
				prevOptions.inViewOptions !== options.inViewOptions
			// ...and never once the element is exiting: `startExit()` deliberately
			// unbound them, and re-arming here would let a gesture landing mid-exit
			// cut the exit animation short
			if (gesturesChanged && current && !active.exit) {
				current.unbindGestures?.()
				current.unbindGestures = bindGestures(current.element)
			}

			const nextAnimate = resolveTarget(options.animate, options.variants) ?? {}
			if (!active.exit && prevAnimate !== JSON.stringify(nextAnimate)) {
				void animateToTarget(computeEffectiveTarget())
			}
		},
		startExit() {
			active.exit = true

			const ctx = current
			/*
			Gestures would otherwise stay bound for the whole exit window (the
			mount disposer only runs once the exit is over), so a `pointerleave`
			or `pressend` landing mid-exit would cancel and restart the exit
			animation, stranding the latch on an animation that can no longer
			complete. Unbind at exit start, and clear the handle so the disposer
			can't unbind a second time.
			*/
			ctx?.unbindGestures?.()
			if (ctx) ctx.unbindGestures = undefined

			const target = computeEffectiveTarget()
			// nothing animatable (e.g. `exit="typo"`, or an exit target carrying
			// only a `transition`): say so synchronously so the caller unmounts
			// now instead of waiting on a promise that would never settle
			if (!ctx || Object.keys(targetValues(target)).length === 0) return null

			let resolve!: () => void
			const latch = new Promise<void>(r => (resolve = r))
			ctx.resolveExit = resolve
			void animateToTarget(target, true)
			return latch
		},
		getTarget: getStartTarget,
		getOptions: () => options,
		getInitialVariantKey,
	}
	return state
}
