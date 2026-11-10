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
  tub: (
    <>
      <path d="M26 54h68l-6 38a4 4 0 0 1-4 3.4H36a4 4 0 0 1-4-3.4Z" fill={W} />
      <path d="M29 70h62" stroke={T} strokeWidth="3" />
      <rect x="20" y="42" width="80" height="12" rx="5" fill={T} />
      <path d="M28 42c3-5 9-7 32-7s29 2 32 7" fill={W} />
    </>
  ),
  clamshell: (
    <>
      <path d="M20 70h80l-6 26a4 4 0 0 1-4 3H30a4 4 0 0 1-4-3Z" fill={W} />
      <path d="M26 70l4-30a4 4 0 0 1 4-3.5h52a4 4 0 0 1 4 3.5l4 30" fill={T} fillOpacity="0.55" />
      <path d="M36 50h48" stroke={W} strokeWidth="3" />
      <path d="M18 70h84" strokeWidth="3" />
      <rect x="54" y="66" width="12" height="9" rx="2" fill={W} />
    </>
  ),
  tray: (
    <>
      <path d="M14 62h92l-10 24a4 4 0 0 1-3.7 2.5H27.7A4 4 0 0 1 24 86Z" fill={W} />
      <path d="M24 62l6-10h60l6 10" fill={T} />
      <path d="M32 74h56" stroke={T} strokeWidth="3" />
    </>
  ),
  plate: (
    <>
      <ellipse cx="60" cy="64" rx="46" ry="22" fill={W} />
      <ellipse cx="60" cy="62" rx="30" ry="12" fill={T} />
      <path d="M22 70c8 7 22 11 38 11s30-4 38-11" stroke={T} strokeWidth="3" />
    </>
  ),
  utensils: (
    <>
      <g transform="rotate(-18 60 60)">
        <rect x="40" y="56" width="8" height="52" rx="4" fill={W} />
        <path d="M36 16v24a8 8 0 0 0 16 0V16" fill={T} />
        <path d="M44 16v22" />
      </g>
      <g transform="rotate(18 60 60)">
        <rect x="72" y="56" width="8" height="52" rx="4" fill={W} />
        <ellipse cx="76" cy="34" rx="12" ry="20" fill={T} />
      </g>
    </>
  ),
  skewer: (
    <>
      <g transform="rotate(-30 60 60)">
        <path d="M57 10l3-6 3 6v100h-6Z" fill={W} />
        <path d="M66 10l3-6 3 6v100h-6Z" fill={T} />
        <path d="M48 10l3-6 3 6v100h-6Z" fill={T} />
      </g>
    </>
  ),
  bag: (
    <>
      <path d="M28 30h64v70a4 4 0 0 1-4 4H32a4 4 0 0 1-4-4Z" fill={W} />
      <path d="M28 42h64" stroke={T} strokeWidth="4" />
      <path d="M28 30l8-10h48l8 10" fill="#efedf3" />
      <rect x="40" y="62" width="40" height="22" rx="3" fill={T} />
    </>
  ),
  receipt: (
    <>
      <path d="M32 18h56v84l-7-5-7 5-7-5-7 5-7-5-7 5-7-5-7 5Z" fill={W} />
      <path d="M42 36h36M42 48h36M42 60h24" stroke={T} strokeWidth="3" />
      <rect x="42" y="72" width="36" height="10" rx="2" fill={T} />
    </>
  ),
  mask: (
    <>
      <path d="M18 50c8-3 14-4 18-4M102 50c-8-3-14-4-18-4M18 78c8 2 14 2 18 0M102 78c-8 2-14 2-18 0" />
      <path d="M36 44c16-5 32-5 48 0v36c-16 7-32 7-48 0Z" fill={W} />
      <path d="M38 56h44M38 66h44" stroke={T} strokeWidth="3" />
    </>
  ),
  mop: (
    <>
      <rect x="57" y="10" width="6" height="66" rx="3" fill={W} />
      <rect x="44" y="72" width="32" height="10" rx="3" fill={T} />
      <path d="M46 82l-8 26M52 82l-4 28M58 82v28M64 82l2 28M70 82l6 27M75 82l10 25" strokeWidth="4" />
    </>
  ),
  fuel: (
    <>
      <path d="M60 18c8 9 12 16 12 22a12 12 0 0 1-24 0c0-6 4-13 12-22Z" fill={T} />
      <rect x="34" y="56" width="52" height="46" rx="5" fill={W} />
      <rect x="31" y="50" width="58" height="10" rx="3" fill={T} />
      <rect x="42" y="72" width="36" height="16" rx="3" fill={T} />
    </>
  ),
};
