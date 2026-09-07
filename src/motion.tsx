import {Dynamic} from "@solidjs/web"
import type {JSX} from "@solidjs/web"
import {omit, createContext} from "solid-js"
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

	const [state, style] = createAndBindMotionState(
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
	)

	let root!: Element
	return (
		<ParentContext value={state}>
			<Dynamic
				{...attrs}
				ref={(el: Element) => {
					root = el
					props.ref?.(el)
				}}
				component={props.tag || "div"}
				style={combineStyle(props.style, style)}
			/>
		</ParentContext>
	)
}

/** one stable component per tag, so `Motion.div === Motion.div` */
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
	get(target, key, receiver) {
		/*
		Only string keys that aren't already properties of MotionComponent name a
		tag. Trapping *every* key made `Motion.then` a function, which is enough
		for any promise-resolution path to treat `Motion` itself as a thenable
		and call it; `MotionComponent`'s own function properties (`name`,
		`length`, `call`, `prototype`, ...) don't collide with any HTML tag name,
		so forwarding them is safe.
		*/
		if (typeof key !== "string" || key === "then" || key in target)
			return Reflect.get(target, key, receiver)

		let component = tagComponents.get(key)
		if (!component) {
			component = props => <MotionComponent {...props} tag={key} />
			tagComponents.set(key, component)
		}
		return component
	},
}) as MotionProxy
