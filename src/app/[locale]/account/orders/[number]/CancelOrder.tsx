"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { cancelOrder, type CancelState } from "../../actions";
import styles from "../../account.module.css";

interface Labels {
  cancel: string;
  hint: string;
  ask: string;
  yes: string;
  no: string;
  canceling: string;
  failed: string;
}

/**
 * Cancels an order that is still "received", in two steps: it cannot be undone,
 * so the first tap only asks. The question takes the place of the link, on the page.
 */
export function CancelOrder({ locale, number, labels }: { locale: Locale; number: number; labels: Labels }) {
  const [state, action, pending] = useActionState<CancelState, FormData>(cancelOrder, {});
  const [asking, setAsking] = useState(false);
  const question = useRef<HTMLParagraphElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  // Focus follows the step: to the question when it opens, back to the link when it closes.
  useEffect(() => {
    if (asking) question.current?.focus();
    else if (wasAsking.current) opener.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  if (!asking) {
    return (
      <div className={styles.cancel}>
        <button type="button" className={styles.textButton} onClick={() => setAsking(true)} ref={opener}>
          {labels.cancel}
        </button>
        <p className="small muted">{labels.hint}</p>
      </div>
    );
  }

  return (
    <form action={action} className={`${styles.cancel} ${styles.cancelAsk}`}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="number" value={number} />
      <p className={styles.cancelQuestion} ref={question} tabIndex={-1}>
        {labels.ask}
      </p>
      <div className={styles.row}>
        <button type="submit" className="btn" disabled={pending}>
          {pending ? labels.canceling : labels.yes}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setAsking(false)} disabled={pending}>
          {labels.no}
        </button>
      </div>
      {state.failed && !pending ? (
        <p className="error-text" role="alert">
          {labels.failed}
        </p>
      ) : null}
    </form>
  );
}
