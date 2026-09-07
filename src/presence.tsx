import {resolveElements, resolveFirst} from "@solid-primitives/refs"
import {createListTransition, createSwitchTransition} from "@solid-primitives/transition-group"
import {
	createContext,
	createMemo,
	createSignal,
	flush,
	onSettled,
	untrack,
	useContext,
	type Context,
	type FlowComponent,
	type Accessor,
} from "solid-js"
import type {JSX} from "@solidjs/web"

/*
Solid 2.0's useContext throws ContextNotFoundError whenever the resolved value
is undefined, even with an explicit `undefined` default — there's no built-in
way to ask "is there a provider" without throwing. ParentContext/PresenceContext
are legitimately optional (most Motion components have neither an ancestor
Presence nor a parent Motion), so reads of them go through this instead.
*/
/** @internal */
export function tryUseContext<T>(context: Context<T>): T | undefined {
	try {
		return useContext(context)
	} catch {
		return undefined
	}
}

/**
 * How an exiting element hands itself over to its enclosing `Presence`, which
 * then keeps the subtree mounted until every exit inside it has finished.
 */
export interface PresenceExitRegistry {
	/** Hands an exiting element to the `Presence` until `finished` settles. */
	retain(element: Element, finished: Promise<void>): void
	/** Every still-running exit inside `root` (inclusive), matched by DOM containment. */
	pendingIn(root: Element): Promise<void>[]
}

export type PresenceContextState = {
	initial: boolean
	mount: Accessor<boolean>
	/** @internal optional — `createMotion`'s third parameter is public, so a hand-built state may omit it */
	exits?: PresenceExitRegistry
}
export const PresenceContext = createContext<PresenceContextState | undefined>(undefined)

/**
 * Perform exit/enter trantisions of children `<Motion>` components.
 *
 * accepts props:
 * - `initial` – *(Defaults to `true`)* – If `false`, will disable the first animation on all child `Motion` elements the first time `Presence` is rendered.
 * - `exitBeforeEnter` – *(Defaults to `false`)* – If `true`, `Presence` will wait for the exiting element to finish animating out before animating in the next one.
 *
 * @example
 * ```tsx
 * <Presence exitBeforeEnter>
 *   <Show when={toggle()}>
 *     <Motion.div
 *       initial={{ opacity: 0 }}
 *       animate={{ opacity: 1 }}
 *       exit={{ opacity: 0 }}
 *     />
 *   </Show>
 * </Presence>
 * ```
 */
export const Presence: FlowComponent<{
	initial?: boolean
	exitBeforeEnter?: boolean
}> = props => {
	/*
	Every Motion currently animating out under this Presence, whether it's the
	transitioning element itself or any descendant of it. Attribution is by DOM
	containment rather than a parent pointer, so it works for a plain wrapper
	element just as well as for a Motion root.
	*/
	const pending = new Set<{element: Element; finished: Promise<void>}>()
	/*
	`tryUseContext` only ever resolves the *nearest* Presence, so a nested one
	would otherwise hide its exits from an ancestor tearing down the same
	subtree. The ancestor's own onExit runs first, so forwarding the handover
	outward at retain time is enough.
	*/
	const outer = tryUseContext(PresenceContext)

	const exits: PresenceExitRegistry = {
		retain(element, finished) {
			const entry = {element, finished}
			pending.add(entry)
			void finished.then(() => pending.delete(entry))
			outer?.exits?.retain(element, finished)
		},
		pendingIn(root) {
			const result: Promise<void>[] = []
			for (const entry of pending) {
				if (root === entry.element || root.contains(entry.element))
					result.push(entry.finished)
			}
			return result
		},
	}

	/**
	 * Runs `done` once every exit animation inside `el`'s subtree has finished.
	 *
	 * Load-bearing ordering: Solid parks disposal on `_disposalChildren` and
	 * runs it in commitPendingNodes(), which GlobalQueue.flush() executes
	 * strictly *before* run(EFFECT_RENDER) — and EFFECT_RENDER is what invokes
	 * the transition primitive, and so this. Every exiting Motion in the
	 * subtree has therefore already handed itself to `exits` by now, which is
	 * why no mount-time registration is needed. Should that ordering ever
	 * change, this sees an empty set and the nested-exit tests fail loudly.
	 */
	const exitsIn = (el: Element): Promise<unknown> | null => {
		const exiting = exits.pendingIn(el)
		return exiting.length === 0 ? null : Promise.all(exiting)
	}

	/*
	onEnter/onExit below are invoked synchronously from inside the transition
	primitive's own reactive scope, so this internal signal needs ownedWrite to
	allow writing to it from there without Solid 2.0 throwing
	REACTIVE_WRITE_IN_OWNED_SCOPE.
	*/
	const [mount, setMount] = createSignal(true, {ownedWrite: true}),
		state = {initial: props.initial ?? true, mount, exits},
		/*
		Two different primitives, because they answer different questions, and
		which one is used is structural rather than reactive — hence the
		untracked read.

		`exitBeforeEnter` means "one element at a time, and the next one must
		not exist yet". Only a switch transition can express that: it holds the
		incoming element out of the DOM entirely until the outgoing one is done.
		A list transition has no such mode — every child is inserted as soon as
		it appears — so it is used for the ordinary case, where any number of
		children enter and leave independently.

		Both are constructed *inside* the provider below rather than here: they
		resolve `props.children`, and those children read PresenceContext while
		they are being constructed.
		*/
		transition = (): JSX.Element =>
			(untrack(() => props.exitBeforeEnter)
				? createSwitchTransition(
						resolveFirst(() => props.children),
						{
							appear: state.initial,
							mode: "out-in",
							onExit(el, done) {
								/*
								No flush() here: this runs from inside the primitive's
								own render effect, so a flush is already in progress and
								calling it again is a documented no-op
								(FLUSH_IN_EFFECT_CALLBACK). The write is picked up by
								that same flush's continuation, which is what the
								incoming Motion's mount-gating effect reads.
								*/
								setMount(false)

								const exiting = exitsIn(el)
								/*
								Nothing is animating out, so answer synchronously: even
								an already-resolved promise would push `done` a microtask
								out, and "out-in" latches `isExiting` across that gap,
								silently dropping a same-tick source change.
								*/
								if (!exiting) return done()

								// `done` runs from a promise continuation, outside
								// Solid's scheduler, so its write needs a flush scope
								void exiting.then(() => flush(done))
							},
							onEnter(_, done) {
								// same as onExit: already inside the flush running effects
								setMount(true)
								done()
							},
						},
					)
				: createListTransition(
						/*
						`props.children` is memoised before being resolved, because
						reading it re-runs the children expression and
						`resolveElements` re-reads its source on every re-run — so
						without this the whole child list is torn down and rebuilt on
						every change, leaving the *previous* elements to exit while
						brand new ones take their place. `resolveFirst` memoises
						internally for the same reason.
						*/
						resolveElements(createMemo(() => props.children)).toArray,
						{
							appear: state.initial,
							/*
						An element removed from the middle of a list keeps its slot
						while it animates out, rather than jumping to the end of the
						list for the duration of its own exit.
						*/
							exitMethod: "keep-index",
							onChange({removed, finishRemoved}) {
								if (removed.length === 0) return

								/*
							Unlike the switch transition's `onExit`, this runs from the
							primitive's *memo* — during the compute phase, before Solid
							commits disposal of the removed children. Disposal is when
							each Motion hands its exit to `exits`, so checking now would
							always find an empty set and tear the subtree out instantly.
							A microtask lands after the flush has committed, which is
							the point the switch transition's render effect fires at.
							*/
								queueMicrotask(() => {
									// each child leaves on its own schedule
									for (const el of removed) {
										const finish = (): void => flush(() => finishRemoved([el]))
										const exiting = exitsIn(el)
										if (exiting) void exiting.then(finish)
										else finish()
									}
								})
							},
						},
					)) as unknown as JSX.Element,
		render = <PresenceContext value={state}>{transition()}</PresenceContext>

	/*
	`initial={false}` only suppresses the enter animation of the children present
	on the *first* render; anything added later animates in normally. That means
	flipping the flag once the first render is done, which is exactly what
	`onSettled` (Solid 2.0's replacement for 1.x `onMount`) schedules: the next
	point at which the current reactive activity has settled. A bare
	`queueMicrotask` only approximates that by piggybacking on the JS microtask
	queue, which knows nothing about Solid's scheduler and fires whether or not
	the render it is waiting on has actually finished.

	`state.initial` is deliberately a plain field rather than a signal — children
	read it once, untracked, while constructing their own MotionState, and it
	must never re-run anything when it flips.
	*/
	onSettled(() => {
		state.initial = true
	})

	return render
}
