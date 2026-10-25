export type BgKind = "tranquiluxe" | "novatrix" | "velustro" | "plasma" | "ps4" | "ps5" | "bw";

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
  plasma: {
    label: "Плазма",
    accent: "#c26bff",
    accentDeep: "#6b1fb0",
    accentGlow: "rgba(194, 107, 255, 0.35)",
    // Unused: plasma is CSS blend-mode blobs (see BubbleBackground.tsx), not a uvcanvas shader.
    colorA: hexToRgb("#c26bff"),
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
    // Greyscale shader (MonoBackground.tsx, its own fixed palette), so a neutral light grey accent. It is also
    // the default theme (what was once called "Графит" is this one: the old name is read as PS5, see readBgKind).
    label: "PS5",
    accent: "#d6d6d6",
    accentDeep: "#6a6a6a",
    accentGlow: "rgba(214, 214, 214, 0.3)",
    colorA: hexToRgb("#d6d6d6"),
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
export const PLAIN_KINDS: BgKind[] = ["bw"];

export function isPlainKind(kind: BgKind): kind is "bw" {
  return PLAIN_KINDS.includes(kind);
}

/** Base interface tokens a plain theme overrides (everything else keeps the dark defaults of
 *  `:root` in theme.css). */
const PLAIN_TOKENS: Partial<Record<BgKind, Record<string, string>>> = {
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

export const BG_KINDS: BgKind[] = ["tranquiluxe", "novatrix", "velustro", "plasma", "ps4", "ps5", "bw"];

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
  el.dataset.scheme = "dark";
}
