"use client";

import { useRouter } from "next/navigation";
import { showToast } from "@/components/Toaster";
import { listStore } from "@/lib/list-store";

/** Puts a set of lines on the visitor's list (usual order or a past order), then opens the list. */
export function ToListButton({
  lines,
  label,
  done,
  href,
  className = "btn",
}: {
  lines: { sku: string; cases: number }[];
  label: string;
  done: string;
  href: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        for (const l of lines) listStore.setCases(l.sku, l.cases);
        showToast({ message: done, travels: true });
        router.push(href);
      }}
    >
      {label}
    </button>
  );
}
