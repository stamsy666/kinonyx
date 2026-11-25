import type { SVGProps } from "react";

/**
 * The player's own icons («Кромка»): one 24-unit grid, a 2-unit stroke, round ends. They are drawn at 32 px in
 * the controls (44 px in the centre button) and take `currentColor`, so a focused (white) button turns them dark.
 */
type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size ?? 32}
      height={size ?? 32}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

const fill = { fill: "currentColor", stroke: "none" } as const;

export const KxBack = (p: P) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);
export const KxPlay = (p: P) => (
  <Svg {...p}>
    <path {...fill} d="M8 5.6v12.8a1 1 0 0 0 1.53.85l10.2-6.4a1 1 0 0 0 0-1.7L9.53 4.75A1 1 0 0 0 8 5.6z" />
  </Svg>
);
export const KxPause = (p: P) => (
  <Svg {...p}>
    <rect {...fill} x="5.5" y="4.5" width="4.6" height="15" rx="1.4" />
    <rect {...fill} x="13.9" y="4.5" width="4.6" height="15" rx="1.4" />
  </Svg>
);
/** A circular arrow back with the step in it ("15", "30"). */
export const KxRewind = ({ step, ...p }: P & { step: number }) => (
  <Svg {...p}>
    <path d="M12 5a8 8 0 1 1-8 8" />
    <path {...fill} d="M12.4 1.4v7.2L7.4 5z" />
    <text x="12" y="16.6" textAnchor="middle" fontSize="8.4" fontWeight="700" {...fill} fontFamily="inherit">
      {step}
    </text>
  </Svg>
);
export const KxForward = ({ step, ...p }: P & { step: number }) => (
  <Svg {...p}>
    <path d="M12 5a8 8 0 1 0 8 8" />
    <path {...fill} d="M11.6 1.4v7.2L16.6 5z" />
    <text x="12" y="16.6" textAnchor="middle" fontSize="8.4" fontWeight="700" {...fill} fontFamily="inherit">
      {step}
    </text>
  </Svg>
);
export const KxNext = (p: P) => (
  <Svg {...p}>
    <path {...fill} d="M5 5.8v12.4a.8.8 0 0 0 1.26.65L15 12.65a.8.8 0 0 0 0-1.3L6.26 5.15A.8.8 0 0 0 5 5.8z" />
    <path d="M19 5v14" />
  </Svg>
);
export const KxPrev = (p: P) => (
  <Svg {...p}>
    <path {...fill} d="M19 5.8v12.4a.8.8 0 0 1-1.26.65L9 12.65a.8.8 0 0 1 0-1.3l8.74-6.2A.8.8 0 0 1 19 5.8z" />
    <path d="M5 5v14" />
  </Svg>
);
export const KxEpisodes = (p: P) => (
  <Svg {...p}>
    <path d="M3 6h12M3 12h9M3 18h7" />
    <path {...fill} d="M15.5 13v6.4a.6.6 0 0 0 .92.5l5-3.2a.6.6 0 0 0 0-1l-5-3.2a.6.6 0 0 0-.92.5z" />
  </Svg>
);
export const KxAudio = (p: P) => (
  <Svg {...p}>
    <path d="M3 10v4M7.5 6v12M12 3v18M16.5 7.5v9M21 10v4" />
  </Svg>
);
export const KxSubtitles = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="3.2" />
    <path d="M6.5 14.8h4M13.5 14.8h4M6.5 10.8h2.5M12 10.8h5.5" />
  </Svg>
);
export const KxPicture = (p: P) => (
  <Svg {...p}>
    <path d="M3 7h10M19 7h2M3 17h2M11 17h10" />
    <circle cx="16" cy="7" r="2.6" />
    <circle cx="8" cy="17" r="2.6" />
  </Svg>
);
export const KxSkip = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l6 6-6 6M13 6l6 6-6 6" />
  </Svg>
);
export const KxMini = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="4.5" width="19" height="15" rx="3.2" />
    <rect {...fill} x="11.5" y="11.5" width="7" height="5" rx="1.2" />
  </Svg>
);
const speaker = "M11 5.2 6.6 9H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.6l4.4 3.8a.6.6 0 0 0 1-.46V5.66a.6.6 0 0 0-1-.46z";
export const KxVolume = (p: P) => (
  <Svg {...p}>
    <path d={speaker} />
    <path d="M15.8 9a4.3 4.3 0 0 1 0 6M18.6 6.4a8 8 0 0 1 0 11.2" />
  </Svg>
);
export const KxMute = (p: P) => (
  <Svg {...p}>
    <path d={speaker} />
    <path d="M16.5 9.5l5 5M21.5 9.5l-5 5" />
  </Svg>
);
export const KxHeart = ({ on, ...p }: P & { on?: boolean }) => (
  <Svg {...p}>
    <path fill={on ? "currentColor" : "none"} d="M12 20.3s-8-4.9-8-10.9A4.6 4.6 0 0 1 12 6.9a4.6 4.6 0 0 1 8 2.5c0 6-8 10.9-8 10.9z" />
  </Svg>
);
export const KxArchive = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 3.5v4.2h4.2M12 7.5V12l3 1.8" />
  </Svg>
);
export const KxCheck = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 12.5l5 5L19.5 7" />
  </Svg>
);
export const KxClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const KxExpand = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />
  </Svg>
);
export const KxHd = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="3.5" />
    <path d="M7 9.2v5.6M7 12h3.2M10.2 9.2v5.6M13.4 9.2v5.6h1.4a2.8 2.8 0 0 0 0-5.6z" />
  </Svg>
);
export const KxAlert = (p: P) => (
  <Svg {...p}>
    <path d="M12 8.5v4.5M10.3 3.9 2.6 17.5a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <circle {...fill} cx="12" cy="16.6" r="1.1" />
  </Svg>
);
export const KxRetry = (p: P) => (
  <Svg {...p}>
    <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1M20.5 3.5v4.2h-4.2" />
  </Svg>
);
