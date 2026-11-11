"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * A link that fetches its page once someone shows they want it (a pointer over it,
 * a finger down on it, keyboard focus), not the moment it scrolls into view.
 *
 * Use it where a page shows many links, or a link to a page with big photos.
 * Fetching a page ahead of time also downloads the photos that page asks for first:
 * with plain links, every page pulled in the three home page photos (325 KB), and
 * the products page pulled in each product page as its card scrolled by.
 */
export function IntentLink({ onPointerEnter, onTouchStart, onFocus, ...props }: ComponentProps<typeof Link>) {
  const [wanted, setWanted] = useState(false);
  return (
    <Link
      {...props}
      prefetch={wanted ? null : false}
      onPointerEnter={(e) => {
        setWanted(true);
        onPointerEnter?.(e);
      }}
      onTouchStart={(e) => {
        setWanted(true);
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        setWanted(true);
        onFocus?.(e);
      }}
    />
  );
}
