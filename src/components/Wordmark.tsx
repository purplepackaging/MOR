import styles from "./Wordmark.module.css";

/** The O in MOR is a loop: More On Repeat. */
export function LoopMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      className={className}
      viewBox="24 1 26 27"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
      focusable="false"
    >
      <path
        d="M41.79 5.19A10.2 10.2 0 1 1 32.21 5.19"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.4"
      />
      <path d="M36.4 3.05 32.9 8.75 29.6 2.6Z" fill="currentColor" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`${styles.wordmark} ${className ?? ""}`} translate="no">
      <svg className={styles.mark} viewBox="0 0 72 28" aria-hidden="true" focusable="false">
        <path
          d="M3.7 25.2V3.4l8.65 13.2L21 3.4v21.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.4"
          strokeLinejoin="round"
        />
        <g className={styles.loop}>
          <path
            d="M41.79 5.19A10.2 10.2 0 1 1 32.21 5.19"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.4"
          />
          <path d="M36.4 3.05 32.9 8.75 29.6 2.6Z" fill="currentColor" />
        </g>
        <path
          d="M53.7 25.2V3.4h7.9a6.6 6.6 0 0 1 0 13.2h-7.9m6.6 0 8.7 8.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.4"
          strokeLinejoin="round"
        />
      </svg>
      <span className={styles.supply}>Supply</span>
    </span>
  );
}
