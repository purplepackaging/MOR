/**
 * One sign-in check per page view, shared by the header and by product prices.
 * It runs again after each navigation, so signing in or out shows right away.
 */
let last: { path: string; result: Promise<boolean> } | null = null;
const signedOutListeners = new Set<() => void>();

export function checkSession(path: string): Promise<boolean> {
  if (last?.path !== path) {
    const result = fetch("/api/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { signedIn: false }))
      .then((j: { signedIn?: boolean }) => Boolean(j.signedIn))
      .catch(() => false);
    last = { path, result };
    void result.then((signedIn) => {
      if (!signedIn) for (const listener of signedOutListeners) listener();
    });
  }
  return last.result;
}

/** Runs whenever a check finds nobody signed in, so nothing private outlives the session. */
export function onSignedOut(listener: () => void): void {
  signedOutListeners.add(listener);
}
