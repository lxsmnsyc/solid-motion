/*
The same 80x80 square every story animates. Shared so the examples differ only
in the behaviour they demonstrate, rather than in incidental styling.
*/
export const box = {
	width: "80px",
	height: "80px",
	"border-radius": "8px",
	background: "royalblue",
} as const

/** A second square, so a story can show two elements moving against each other. */
export const accent = {...box, background: "crimson"} as const

/** Lays a story's controls and subject out without fighting the docs page. */
export const row = {display: "flex", gap: "16px", "align-items": "center"} as const
