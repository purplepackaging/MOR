"use client";

import { useEffect } from "react";

/**
 * Sets the tab's title from inside a page. For the not-found page only: a product or category with nothing
 * to sell is built ahead of time as "not found", and Next gives that page the site's default title whatever
 * the route's own metadata says. Every other page sets its title through its metadata.
 */
export function PageTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = title;
  }, [title]);
  return null;
}
