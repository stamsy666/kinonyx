export type BgKind =
  | "tranquiluxe"
  | "novatrix"
  | "velustro"
  | "opulento"
  | "lumiflex"
  | "aurora"
  | "cloud"
  | "plasma"
  | "bloom"
  | "mono"
  | "ps4"
  | "ps5"
  | "light"
  | "bw"
  | "netflix";

export interface BgPalette {
  label: string;
  /** Interface accent tokens applied app-wide while this theme is active. */
  accent: string;
  accentDeep: string;
  accentGlow: string;
  /** Colour handed to the background's own effect. */
  colorA: [number, number, number];
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export const BG_PALETTES: Record<BgKind, BgPalette> = {
  tranquiluxe: {
    label: "Штиль",
    accent: "#c9a8ff",
    accentDeep: "#8f5fd1",
    accentGlow: "rgba(201, 168, 255, 0.35)",
    colorA: hexToRgb("#c9a8ff"),
  },
  novatrix: {
    label: "Спектр",
    accent: "#ff4fd8",
    accentDeep: "#a825a0",
    accentGlow: "rgba(255, 79, 216, 0.35)",
    colorA: hexToRgb("#ff4fd8"),
  },
  velustro: {
    label: "Бархат",
    accent: "#1fb888",
    accentDeep: "#0d7a5a",
    accentGlow: "rgba(31, 184, 136, 0.35)",
    colorA: hexToRgb("#1fb888"),
  },
  opulento: {
    label: "Опал",
    accent: "#e8b649",
    accentDeep: "#a87a1f",
    accentGlow: "rgba(232, 182, 73, 0.35)",
    colorA: hexToRgb("#e8b649"),
  },
  lumiflex: {
    label: "Сияние",
    accent: "#4fe0ff",
    accentDeep: "#1f8fb0",
    accentGlow: "rgba(79, 224, 255, 0.35)",
    colorA: hexToRgb("#4fe0ff"),
  },
  aurora: {
    label: "Аврора",
    accent: "#8b9dff",
    accentDeep: "#4a4fc4",
    accentGlow: "rgba(139, 157, 255, 0.35)",
    // Unused: aurora is a plain-CSS effect (see AuroraBackground.tsx), not a uvcanvas shader —
    // kept here only so this palette stays a normal BgPalette (every consumer of BG_PALETTES
    // indexes it the same way, no "if aurora" special-casing needed outside AppBackground).
    colorA: hexToRgb("#8b9dff"),
  },
  cloud: {
    label: "Пелена",
    accent: "#9db4d9",
    accentDeep: "#4f6491",
    accentGlow: "rgba(157, 180, 217, 0.35)",
    // Unused, same reason as aurora: cloud is a hand-rolled WebGL shader (see
    // CloudBackground.tsx) with its own fixed, already-dark palette, not a uvcanvas effect.
    colorA: hexToRgb("#9db4d9"),
  },
  plasma: {
    label: "Плазма",
    accent: "#c26bff",
    accentDeep: "#6b1fb0",
    accentGlow: "rgba(194, 107, 255, 0.35)",
    // Unused, same reason as aurora/cloud: plasma is CSS blend-mode blobs (see
    // BubbleBackground.tsx), not a uvcanvas shader.
    colorA: hexToRgb("#c26bff"),
  },
  bloom: {
    label: "Мгла",
    // The backdrop itself is near-black charcoal, so the interface accent is a soft warm silver.
    accent: "#cfcac0",
    accentDeep: "#6e6a60",
    accentGlow: "rgba(207, 202, 192, 0.3)",
    // Unused, same reason as aurora/cloud/plasma: a plain-CSS mesh gradient (BloomBackground.tsx).
    colorA: hexToRgb("#cfcac0"),
  },
  mono: {
    label: "Графит",
    // Greyscale shader, so a neutral light grey accent.
    accent: "#d6d6d6",
    accentDeep: "#6a6a6a",
    accentGlow: "rgba(214, 214, 214, 0.3)",
    // Unused: a hand-rolled WebGL shader with its own fixed palette (MonoBackground.tsx).
    colorA: hexToRgb("#d6d6d6"),
  },
  ps4: {
    label: "PS4",
    accent: "#5ab4ff",
    accentDeep: "#1f5fb0",
    accentGlow: "rgba(90, 180, 255, 0.35)",
    // Unused: plain-CSS waves (WavesBackground.tsx).
    colorA: hexToRgb("#5ab4ff"),
  },
  ps5: {
    // A twin of "Графит" (same shader, same greys) as its own exclusive theme.
    label: "PS5",
    accent: "#d6d6d6",
    accentDeep: "#6a6a6a",
    accentGlow: "rgba(214, 214, 214, 0.3)",
    colorA: hexToRgb("#d6d6d6"),
  },
  // The two plain (static) themes: no animated canvas at all, they re-skin the interface
  // tokens instead (see PLAIN_TOKENS). `colorA` is unused, as for the other non-uvcanvas kinds.
  light: {
    label: "Белая",
    accent: "#e63950",
    accentDeep: "#a11f31",
    accentGlow: "rgba(230, 57, 80, 0.3)",
    colorA: hexToRgb("#e63950"),
  },
  netflix: {
    // Cinema look: near-black charcoal, one saturated red, small radii, quick motion.
    label: "Netflix",
    accent: "#e50914",
    accentDeep: "#b20710",
    accentGlow: "rgba(229, 9, 20, 0.38)",
    colorA: hexToRgb("#e50914"),
  },
  bw: {
    label: "Ч/Б",
    accent: "#ffffff",
    accentDeep: "#8a8a8a",
    accentGlow: "rgba(255, 255, 255, 0.28)",
    colorA: hexToRgb("#ffffff"),
  },
};

/** Themes without an animated background — plain colour schemes. */
export const PLAIN_KINDS: BgKind[] = ["netflix", "light", "bw"];

export function isPlainKind(kind: BgKind): kind is "light" | "bw" | "netflix" {
  return PLAIN_KINDS.includes(kind);
}

/** Base interface tokens a plain theme overrides (everything else keeps the dark defaults of
 *  `:root` in theme.css). */
const PLAIN_TOKENS: Partial<Record<BgKind, Record<string, string>>> = {
  light: {
    "--bg": "#f3f1ee",
    "--bg-2": "#ffffff",
    "--surface": "rgba(0, 0, 0, 0.05)",
    "--surface-hi": "rgba(0, 0, 0, 0.09)",
    "--line": "rgba(0, 0, 0, 0.1)",
    "--line-hi": "rgba(0, 0, 0, 0.2)",
    "--text": "#16120f",
    "--text-dim": "rgba(22, 18, 15, 0.62)",
    "--text-faint": "rgba(22, 18, 15, 0.4)",
    "--gold": "#b97d0a",
    "--teal": "#0f8f84",
  },
  netflix: {
    "--bg": "#232323",
    "--bg-2": "#1a1a1a",
    "--surface": "rgba(255, 255, 255, 0.055)",
    "--surface-hi": "rgba(255, 255, 255, 0.11)",
    "--line": "rgba(255, 255, 255, 0.1)",
    "--line-hi": "rgba(128, 128, 128, 0.6)",
    "--text": "#ffffff",
    "--text-dim": "rgba(255, 255, 255, 0.66)",
    "--text-faint": "rgba(255, 255, 255, 0.4)",
    "--gold": "#f5c518",
    "--teal": "#46d369",
    "--radius": "8px",
    "--radius-sm": "4px",
    "--ease": "cubic-bezier(0.4, 0, 0.2, 1)",
  },
  bw: {
    "--bg": "#000000",
    "--bg-2": "#0c0c0c",
    "--surface": "rgba(255, 255, 255, 0.06)",
    "--surface-hi": "rgba(255, 255, 255, 0.11)",
    "--line": "rgba(255, 255, 255, 0.1)",
    "--line-hi": "rgba(255, 255, 255, 0.2)",
    "--text": "#f5f5f5",
    "--text-dim": "rgba(245, 245, 245, 0.6)",
    "--text-faint": "rgba(245, 245, 245, 0.36)",
    "--gold": "#d4d4d4",
    "--teal": "#b5b5b5",
  },
};

const ALL_PLAIN_TOKEN_NAMES = Array.from(new Set(Object.values(PLAIN_TOKENS).flatMap((t) => Object.keys(t ?? {}))));

export const BG_KINDS: BgKind[] = [
  "tranquiluxe",
  "novatrix",
  "velustro",
  "opulento",
  "lumiflex",
  "aurora",
  "cloud",
  "plasma",
  "bloom",
  "mono",
  "ps4",
  "ps5",
  "netflix",
  "light",
  "bw",
];

/** Animated themes first, then plain ones — the order Settings shows them in two groups. */
/** Exclusive themes: shown in their own group in Settings, apart from the ordinary ones. */
export const EXCLUSIVE_KINDS: BgKind[] = ["ps4", "ps5"];

export const ANIMATED_KINDS: BgKind[] = BG_KINDS.filter((k) => !isPlainKind(k) && !EXCLUSIVE_KINDS.includes(k));

/** The logo mark is drawn in red (hue ~353°). Turn it to the theme: rotate the hue to the accent's,
 *  or drain the colour for the grey themes. Used as a CSS filter on every logo (--logo-filter). */
function logoFilterFor(accent: string): string {
  const [r, g, b] = hexToRgb(accent);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.12) return "grayscale(1)"; // greys: white, silver, graphite
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return `hue-rotate(${Math.round((h - 353 + 360) % 360)}deg) saturate(1.1)`;
}

export function applyBgPalette(kind: BgKind) {
  const p = BG_PALETTES[kind];
  const root = document.documentElement.style;
  root.setProperty("--accent", p.accent);
  root.setProperty("--accent-deep", p.accentDeep);
  root.setProperty("--accent-glow", p.accentGlow);
  root.setProperty("--logo-filter", logoFilterFor(p.accent));
  // Text on an accent-filled surface (primary button): dark on light accents (greys, silver), white otherwise.
  const [ar, ag, ab] = hexToRgb(p.accent);
  root.setProperty("--on-accent", 0.2126 * ar + 0.7152 * ag + 0.0722 * ab > 0.55 ? "#111111" : "#ffffff");

  // Plain themes swap the base colours too; every other theme goes back to the defaults.
  for (const name of ALL_PLAIN_TOKEN_NAMES) root.removeProperty(name);
  for (const [name, value] of Object.entries(PLAIN_TOKENS[kind] ?? {})) root.setProperty(name, value);

  // Hooks for the few CSS rules that must differ per scheme (schemes.css).
  const el = document.documentElement;
  el.dataset.bg = kind;
  el.dataset.scheme = kind === "light" ? "light" : "dark";
}
