import type {StorybookConfig} from "storybook-solidjs-vite"

/*
The framework's own `viteFinal` adds a Solid plugin only when the config does
not already carry one named "solid". It reaches for `vite-plugin-solid`, which
at 3.x is a shim that re-exports `@solidjs/vite-plugin` — the same plugin the
playground and the build use, so stories compile exactly like the library does
and there is only ever one Solid runtime in the bundle.
*/
export default {
	stories: ["../stories/**/*.stories.@(ts|tsx)"],
	framework: "storybook-solidjs-vite",
} satisfies StorybookConfig
