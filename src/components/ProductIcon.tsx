import type { IconName } from "@/data/types";

const W = "#ffffff";
const T = "#e5ddf0";
const M = "#e4e1ea";

/**
 * Drawn stand-ins for products without a photo yet.
 * One stroke weight, white bodies, lilac accents.
 */
export function ProductIcon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

const ICONS: Record<IconName, React.ReactNode> = {
  hotCup: (
    <>
      <path d="M36 36h48l-6.4 63.4a4 4 0 0 1-4 3.6H46.4a4 4 0 0 1-4-3.6L36 36Z" fill={W} />
      <path d="M38.6 58h42.8l-2.2 22H40.8Z" fill={T} />
      <rect x="31" y="27" width="58" height="10" rx="4" fill={W} />
    </>
  ),
  hotLid: (
    <>
      <ellipse cx="60" cy="78" rx="40" ry="12" fill={W} />
      <path d="M26 75c0-15 15-27 34-27s34 12 34 27c0 5-15 9-34 9s-34-4-34-9Z" fill={W} />
      <path d="M33 71c7 4 16 6 27 6s20-2 27-6" stroke={T} strokeWidth="3" />
      <rect x="64" y="54" width="15" height="6" rx="3" fill="currentColor" stroke="none" />
    </>
  ),
  foilRoll: (
    <>
      <path d="M24 72h64l12 28H36Z" fill={M} />
      <path d="M44 86l5 4m10-4 5 4m10-4 5 4" />
      <rect x="22" y="45" width="66" height="27" fill={M} />
      <ellipse cx="22" cy="58.5" rx="6" ry="13.5" fill="#d6d1de" />
      <ellipse cx="88" cy="58.5" rx="6" ry="13.5" fill={W} />
      <ellipse cx="88" cy="58.5" rx="2.2" ry="5" fill="currentColor" stroke="none" />
      <path d="M30 51h48" stroke={W} strokeWidth="3" />
    </>
  ),
  foilSheets: (
    <>
      <path d="M38 60 44 26h36l-6 34" fill="#efedf3" />
      <path d="M44 60 50 32h36l-6 28" fill={M} />
      <path d="M56 40l6 3m6-3 6 3" />
      <path d="M20 60h80v34a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4Z" fill={W} />
      <path d="M34 60h52" strokeWidth="4" />
      <rect x="32" y="74" width="34" height="12" rx="2" fill={T} />
    </>
  ),
  film: (
    <>
      <path d="M26 82h66v22H26Z" fill={T} fillOpacity="0.6" strokeDasharray="0" />
      <path d="M16 50h88v32H16Z" fill={W} />
      <path d="M16 50l10-14h88l-10 14" fill="#efedf3" />
      <path d="M104 50l10-14v32l-10 14" fill="#efedf3" />
      <path d="M22 82l4-4 4 4 4-4 4 4 4-4 4 4 4-4 4 4 4-4 4 4 4-4 4 4 4-4 4 4 4-4 4 4 4-4 4 4" />
      <rect x="26" y="58" width="36" height="12" rx="2" fill={T} />
    </>
  ),
  waxPaper: (
    <>
      <rect x="26" y="30" width="58" height="66" rx="3" fill="#efedf3" transform="rotate(-9 55 63)" />
      <rect x="36" y="26" width="58" height="66" rx="3" fill={W} transform="rotate(5 65 59)" />
      <path d="M48 46h32M47 57h32M46 68h22" stroke={T} strokeWidth="3" transform="rotate(5 65 59)" />
      <path d="M80 26h14v14Z" fill={T} transform="rotate(5 65 59)" />
    </>
  ),
  straw: (
    <>
      <g transform="rotate(-24 60 60)">
        <rect x="55" y="12" width="10" height="96" rx="5" fill={W} />
        <path d="M55 30l10-5M55 46l10-5M55 62l10-5M55 78l10-5M55 94l10-5" stroke={T} strokeWidth="3" />
      </g>
      <g transform="rotate(20 60 60)">
        <rect x="53" y="14" width="14" height="92" rx="3" fill={T} />
        <path d="M53 22h14M53 98h14" />
        <path d="M60 30v60" stroke={W} strokeWidth="3" />
      </g>
    </>
  ),
  glove: (
    <>
      <rect x="44" y="22" width="11" height="48" rx="5.5" fill={T} />
      <rect x="56" y="15" width="11" height="55" rx="5.5" fill={T} />
      <rect x="68" y="20" width="11" height="50" rx="5.5" fill={T} />
      <rect x="80" y="31" width="10" height="40" rx="5" fill={T} />
      <rect x="27" y="50" width="11" height="34" rx="5.5" fill={T} transform="rotate(-38 32.5 84)" />
      <path d="M42 60h48v26a10 10 0 0 1-10 10H52a10 10 0 0 1-10-10Z" fill={T} stroke="none" />
      <path d="M42 62v24a10 10 0 0 0 10 10h28a10 10 0 0 0 10-10V64" />
      <rect x="46" y="94" width="40" height="13" rx="3" fill={W} />
    </>
  ),
  cap: (
    <>
      <path d="M22 74c0-22 17-38 38-38s38 16 38 38" fill={W} />
      <path d="M41 45c-3 9-3 20-1 29M60 38v37M79 45c3 9 3 20 1 29" stroke={T} strokeWidth="3" />
      <path d="M20 73c9 6 24 10 40 10s31-4 40-10v7c-9 6-24 10-40 10s-31-4-40-10Z" fill={T} />
    </>
  ),
  apron: (
    <>
      <path d="M46 34c0-13 28-13 28 0" />
      <path d="M42 34h36l4 22 12 7v39a4 4 0 0 1-4 4H30a4 4 0 0 1-4-4V63l12-7Z" fill={W} />
      <path d="M26 66c-8 0-12 6-14 13M94 66c8 0 12 6 14 13" />
      <rect x="45" y="76" width="30" height="17" rx="3" fill={T} />
    </>
  ),
  jug: (
    <>
      <path d="M46 40l5-12h14l5 12" fill={W} />
      <rect x="49" y="17" width="18" height="11" rx="2.5" fill={T} />
      <path d="M34 40h52a6 6 0 0 1 6 6v54a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6V46a6 6 0 0 1 6-6Z" fill={W} />
      <path d="M74 40h8a6 6 0 0 1 6 6v18h-10V50h-4Z" fill="#efedf3" />
      <rect x="36" y="66" width="44" height="26" rx="3" fill={T} />
    </>
  ),
  pump: (
    <>
      <path d="M60 37V24" />
      <path d="M50 24h28a4 4 0 0 1 4 4H50Z" fill={W} />
      <path d="M82 26h8" />
      <path d="M92 36c2.2 3.2 3.4 5.4 3.4 7a3.4 3.4 0 0 1-6.8 0c0-1.6 1.2-3.8 3.4-7Z" fill={T} />
      <rect x="50" y="37" width="20" height="10" rx="2" fill={T} />
      <rect x="37" y="47" width="46" height="59" rx="11" fill={W} />
      <rect x="44" y="64" width="32" height="26" rx="3" fill={T} />
    </>
  ),
};
