"use client";

import Link from "next/link";
import { useSignedIn } from "./HeaderClient";

interface Target {
  href: string;
  label: string;
}

/**
 * Pages are built ahead of time, the same for everyone. These two read one way
 * for a visitor and another for a signed-in customer, once the session check
 * has answered. Until then they show the visitor's version.
 */
export function SessionLink({
  portal,
  signedOut,
  signedIn,
  className,
}: {
  portal: boolean;
  signedOut: Target;
  signedIn: Target;
  className?: string;
}) {
  const link = useSignedIn(portal) ? signedIn : signedOut;
  return (
    <Link className={className} href={link.href}>
      {link.label}
    </Link>
  );
}

export function SessionText({ portal, signedOut, signedIn }: { portal: boolean; signedOut: string; signedIn: string }) {
  return <>{useSignedIn(portal) ? signedIn : signedOut}</>;
}
