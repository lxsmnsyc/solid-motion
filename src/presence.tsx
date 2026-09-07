import {resolveFirst} from "@solid-primitives/refs"
import {createSwitchTransition} from "@solid-primitives/transition-group"
import {
	createContext,
	createSignal,
	flush,
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
	element as well as for a Motion root.
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

	/*
	onEnter/onExit below are invoked synchronously from inside
	createSwitchTransition's own createRenderEffect — an owned reactive
	scope — so this internal signal needs ownedWrite to allow writing to it
	from there without Solid 2.0 throwing REACTIVE_WRITE_IN_OWNED_SCOPE.
	*/
	const [mount, setMount] = createSignal(true, {ownedWrite: true}),
		state = {initial: props.initial ?? true, mount, exits},
		render = (
			<PresenceContext value={state}>
				{
					createSwitchTransition(
						resolveFirst(() => props.children),
						{
							appear: state.initial,
							mode: props.exitBeforeEnter ? "out-in" : "parallel",
							onExit(el, done) {
								/*
								onExit/onEnter run outside Solid's own scheduler — so
								signal writes here need an explicit flush to reach
								dependent effects (e.g. a sibling Motion's mount-gating
								effect) before this returns.
								*/
								setMount(false)
								flush()

								/*
								Load-bearing ordering: Solid parks disposal on
								`_disposalChildren` and runs it in commitPendingNodes(),
								which GlobalQueue.flush() executes strictly *before*
								run(EFFECT_RENDER) — and EFFECT_RENDER is what invokes
								createSwitchTransition's effect, and so this callback.
								Every exiting Motion in the subtree has therefore already
								handed itself to `exits` by now, which is why no
								mount-time registration is needed. Should that ordering
								ever change, this sees an empty set and the nested-exit
								tests fail loudly.
								*/
								const exiting = exits.pendingIn(el)

								/*
								Nothing is animating out, so answer synchronously: even an
								already-resolved promise would push `done` a microtask out,
								and "out-in" mode latches `isExiting` across that gap and
								silently drops a same-tick source change.
								*/
								if (exiting.length === 0) return done()

								void Promise.all(exiting).then(() => {
									/*
									`done` (transition-group's own callback) writes the
									signal that actually removes this element from the
									rendered list — also outside Solid's scheduler, so it
									needs its own flush to take effect before callers see it.
									*/
									done()
									flush()
								})
							},
							onEnter(_, done) {
								setMount(true)
								flush()
								done()
							},
						},
					) as any as JSX.Element
				}
			</PresenceContext>
		)

	queueMicrotask(() => (state.initial = true))
	return render
}
