export type BgKind =
  | "tranquiluxe"
  | "novatrix"
  | "velustro"
  | "opulento"
  | "lumiflex"
  | "aurora"
  | "cloud"
  | "plasma";

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
};

export const BG_KINDS: BgKind[] = [
  "tranquiluxe",
  "novatrix",
  "velustro",
  "opulento",
  "lumiflex",
  "aurora",
  "cloud",
  "plasma",
];

export function applyBgPalette(kind: BgKind) {
  const p = BG_PALETTES[kind];
  const root = document.documentElement.style;
  root.setProperty("--accent", p.accent);
  root.setProperty("--accent-deep", p.accentDeep);
  root.setProperty("--accent-glow", p.accentGlow);
}
