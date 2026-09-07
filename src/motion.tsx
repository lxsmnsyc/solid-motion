import {Dynamic} from "@solidjs/web"
import type {JSX} from "@solidjs/web"
import {merge, omit, untrack, createContext} from "solid-js"
import {combineStyle} from "@solid-primitives/props"
import {MotionState} from "./engine.js"

import type {MotionComponentProps, MotionProxy, MotionProxyComponent} from "./types.js"
import {createAndBindMotionState} from "./primitives.js"
import {PresenceContext, tryUseContext} from "./presence.jsx"

const OPTION_KEYS = [
	"initial",
	"animate",
	"inView",
	"inViewOptions",
	"hover",
	"press",
	"variants",
	"transition",
	"exit",
] as const

const ATTR_KEYS = ["tag"] as const

export const ParentContext = createContext<MotionState | undefined>(undefined)

/** @internal */
export const MotionComponent = (
	props: MotionComponentProps & {
		tag?: string
		ref?: any
		style?: JSX.CSSProperties | string
	},
): JSX.Element => {
	const attrs = omit(props, ...OPTION_KEYS, ...ATTR_KEYS)
	/*
	Read once, untracked. The rendered tag decides how the *start* target is
	built (SVG geometry as attributes vs. HTML styles), which is a one-shot
	decision made before anything is mounted — and swapping an element's tag
	mid-life would mean replacing the node, not updating it. Reading it
	reactively here would only earn a STRICT_READ_UNTRACKED warning for a
	subscription nothing can act on.
	*/
	const tag = untrack(() => props.tag) || "div"

	const [state, startStyles] = createAndBindMotionState(
		() => root,
		() => ({
			initial: props.initial,
			animate: props.animate,
			inView: props.inView,
			inViewOptions: props.inViewOptions,
			hover: props.hover,
			press: props.press,
			variants: props.variants,
			transition: props.transition,
			exit: props.exit,
		}),
		tryUseContext(PresenceContext),
		tryUseContext(ParentContext),
		tag,
	)

	/*
	Folded into one object rather than spread separately: an extra prop source
	shifts Solid's hydration key numbering and adds a stray separator to the
	rendered markup, so an element with no SVG geometry keeps exactly the props
	it had before. The start target goes last so its geometry wins over a
	same-named prop, matching how the computed style layers over `props.style`.
	*/
	const renderedAttrs = Object.keys(startStyles.attrs).length
		? merge(attrs, startStyles.attrs)
		: attrs

	let root!: Element
	return (
		<ParentContext value={state}>
			<Dynamic
				{...renderedAttrs}
				ref={(el: Element) => {
					root = el
					props.ref?.(el)
				}}
				component={tag}
				style={combineStyle(props.style, startStyles.style)}
			/>
		</ParentContext>
	)
}

/** one memoised component per tag — see the `get` trap below */
const tagComponents = new Map<string, MotionProxyComponent<any>>()

/**
 * Renders an animatable HTML or SVG element.
 *
 * @component
 * Animation props:
 * - `animate` a target of values to animate to. Accepts all the same values and keyframes as Motion One's [animate function](https://motion.dev/dom/animate). This prop is **reactive** – changing it will animate the transition element to the new state.
 * - `transition` for changing type of animation
 * - `initial` a target of values to animate from when the element is first rendered.
 * - `exit` a target of values to animate to when the element is removed. Requires a `<Presence>` ancestor — the element can sit anywhere inside the subtree `Presence` transitions, not just at its root.
 *
 * @example
 * ```tsx
 * <Motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}/>
 * ```
 *
 * Interaction animation props:
 *
 * - `inView` animation target for when the element is in view
 * - `hover` animate when hovered
 * - `press` animate when pressed
 *
 * @example
 * ```tsx
 * <Motion.div hover={{ scale: 1.2 }} press={{ scale: 0.9 }}/>
 * ```
 */
export const Motion = new Proxy(MotionComponent, {
	/*
	Only keys the component function doesn't already answer to are treated as tag
	names. Without that fallback every access returns a component — including
	`Motion.then`, which makes `Motion` look like a thenable and hangs anything
	that awaits it or resolves it as a lazily-imported component. `then` is
	excluded explicitly because it isn't a property of `Function.prototype`.
	*/
	get(target, key, receiver) {
		if (typeof key !== "string" || key === "then" || Reflect.has(target, key))
			return Reflect.get(target, key, receiver)

		/*
		Memoised so `Motion.div === Motion.div`. Handing back a fresh component
		on every property access makes the identity of `<Motion.div/>`'s
		component change between renders, which is enough for Solid to treat it
		as a different component and tear the element down instead of updating it.
		*/
		let component = tagComponents.get(key)
		if (!component) {
			component = props => <MotionComponent {...props} tag={key} />
			tagComponents.set(key, component)
		}
		return component
	},
}) as MotionProxy
