import {
  validateSetup,
  valuesFromForm,
  type ErrorCode,
  type SetupKey,
} from "@/lib/request-validation";

/**
 * Shared by the two forms that hold a business's details: the one a new
 * customer fills in, and the one an owner opens later to correct something.
 */

/** Order used to move focus to the first problem. Matches the order on screen. */
export const FIELD_ORDER: SetupKey[] = ["businessName", "street", "city", "zip", "contactName", "phone"];

export type Errors = Partial<Record<SetupKey, ErrorCode>>;

/** The same rules the server applies, run on what is in the form right now. */
export const checkSetup = (form: HTMLFormElement): Errors => validateSetup(valuesFromForm(new FormData(form))).errors;

export function focusFirst(form: HTMLFormElement | null, found: Errors | undefined) {
  const first = found && FIELD_ORDER.find((k) => found[k]);
  if (first) form?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
}

export function TextField({
  name,
  label,
  hint,
  error,
  ...input
}: {
  name: SetupKey;
  label: string;
  hint?: string;
  error?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "id" | "className">) {
  const id = `su-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {hint ? (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="error-text" id={errorId}>
          {error}
        </p>
      ) : null}
      <input
        id={id}
        name={name}
        className="input"
        type="text"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...input}
      />
    </div>
  );
}
