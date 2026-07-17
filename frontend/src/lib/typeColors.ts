/**
 * Deterministic per-entity-type color assignment.
 *
 * 12 curated hues, each defined for dark AND light themes via the `--tc-*`
 * CSS variables in `index.css`. A stable FNV-1a hash of the type key picks
 * the hue, so a given type always renders with the same color everywhere:
 * sidebar dots, table chips, detail headers, palette results, canvas nodes.
 */

export interface TypeColor {
  /** Palette hue name, e.g. "sky". */
  name: string
  /** Solid dot / swatch background, e.g. sidebar dots, canvas node dots. */
  dot: string
  /** Full chip styling: tinted bg + colored text + hairline border. */
  chip: string
  /** Colored text only. */
  text: string
  /** Tinted background only. */
  bg: string
  /** Hairline border in the hue. */
  border: string
  /** Raw CSS value of the solid hue — for inline styles / canvas rendering. */
  cssVar: string
  /** Raw CSS value of the tinted background. */
  bgVar: string
  /** Raw CSS value of the hairline border color. */
  borderVar: string
}

const hue = (name: string): TypeColor => ({
  name,
  dot: `bg-(--tc-${name})`,
  chip: `bg-(--tc-${name}-bg) text-(--tc-${name}) border-(--tc-${name}-border)`,
  text: `text-(--tc-${name})`,
  bg: `bg-(--tc-${name}-bg)`,
  border: `border-(--tc-${name}-border)`,
  cssVar: `var(--tc-${name})`,
  bgVar: `var(--tc-${name}-bg)`,
  borderVar: `var(--tc-${name}-border)`,
})

/**
 * Class strings are written out literally per hue so Tailwind's static
 * scanner picks them up — do not construct these dynamically elsewhere.
 */
export const TYPE_PALETTE: readonly TypeColor[] = [
  {
    ...hue('sky'),
    dot: 'bg-(--tc-sky)',
    chip: 'bg-(--tc-sky-bg) text-(--tc-sky) border-(--tc-sky-border)',
    text: 'text-(--tc-sky)',
    bg: 'bg-(--tc-sky-bg)',
    border: 'border-(--tc-sky-border)',
  },
  {
    ...hue('violet'),
    dot: 'bg-(--tc-violet)',
    chip: 'bg-(--tc-violet-bg) text-(--tc-violet) border-(--tc-violet-border)',
    text: 'text-(--tc-violet)',
    bg: 'bg-(--tc-violet-bg)',
    border: 'border-(--tc-violet-border)',
  },
  {
    ...hue('emerald'),
    dot: 'bg-(--tc-emerald)',
    chip: 'bg-(--tc-emerald-bg) text-(--tc-emerald) border-(--tc-emerald-border)',
    text: 'text-(--tc-emerald)',
    bg: 'bg-(--tc-emerald-bg)',
    border: 'border-(--tc-emerald-border)',
  },
  {
    ...hue('amber'),
    dot: 'bg-(--tc-amber)',
    chip: 'bg-(--tc-amber-bg) text-(--tc-amber) border-(--tc-amber-border)',
    text: 'text-(--tc-amber)',
    bg: 'bg-(--tc-amber-bg)',
    border: 'border-(--tc-amber-border)',
  },
  {
    ...hue('rose'),
    dot: 'bg-(--tc-rose)',
    chip: 'bg-(--tc-rose-bg) text-(--tc-rose) border-(--tc-rose-border)',
    text: 'text-(--tc-rose)',
    bg: 'bg-(--tc-rose-bg)',
    border: 'border-(--tc-rose-border)',
  },
  {
    ...hue('cyan'),
    dot: 'bg-(--tc-cyan)',
    chip: 'bg-(--tc-cyan-bg) text-(--tc-cyan) border-(--tc-cyan-border)',
    text: 'text-(--tc-cyan)',
    bg: 'bg-(--tc-cyan-bg)',
    border: 'border-(--tc-cyan-border)',
  },
  {
    ...hue('lime'),
    dot: 'bg-(--tc-lime)',
    chip: 'bg-(--tc-lime-bg) text-(--tc-lime) border-(--tc-lime-border)',
    text: 'text-(--tc-lime)',
    bg: 'bg-(--tc-lime-bg)',
    border: 'border-(--tc-lime-border)',
  },
  {
    ...hue('fuchsia'),
    dot: 'bg-(--tc-fuchsia)',
    chip: 'bg-(--tc-fuchsia-bg) text-(--tc-fuchsia) border-(--tc-fuchsia-border)',
    text: 'text-(--tc-fuchsia)',
    bg: 'bg-(--tc-fuchsia-bg)',
    border: 'border-(--tc-fuchsia-border)',
  },
  {
    ...hue('orange'),
    dot: 'bg-(--tc-orange)',
    chip: 'bg-(--tc-orange-bg) text-(--tc-orange) border-(--tc-orange-border)',
    text: 'text-(--tc-orange)',
    bg: 'bg-(--tc-orange-bg)',
    border: 'border-(--tc-orange-border)',
  },
  {
    ...hue('teal'),
    dot: 'bg-(--tc-teal)',
    chip: 'bg-(--tc-teal-bg) text-(--tc-teal) border-(--tc-teal-border)',
    text: 'text-(--tc-teal)',
    bg: 'bg-(--tc-teal-bg)',
    border: 'border-(--tc-teal-border)',
  },
  {
    ...hue('blue'),
    dot: 'bg-(--tc-blue)',
    chip: 'bg-(--tc-blue-bg) text-(--tc-blue) border-(--tc-blue-border)',
    text: 'text-(--tc-blue)',
    bg: 'bg-(--tc-blue-bg)',
    border: 'border-(--tc-blue-border)',
  },
  {
    ...hue('pink'),
    dot: 'bg-(--tc-pink)',
    chip: 'bg-(--tc-pink-bg) text-(--tc-pink) border-(--tc-pink-border)',
    text: 'text-(--tc-pink)',
    bg: 'bg-(--tc-pink-bg)',
    border: 'border-(--tc-pink-border)',
  },
]

/** FNV-1a 32-bit — stable, fast, good spread on short keys. */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function getTypeColor(typeKey: string): TypeColor {
  return TYPE_PALETTE[fnv1a(typeKey) % TYPE_PALETTE.length]!
}
