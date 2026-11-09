import { LoopMark } from "./Wordmark";
import styles from "./Ticket.module.css";

export interface TicketLine {
  key: string;
  cases: number | string;
  name: string;
  summary?: string;
}

/**
 * The order ticket: MOR's signature element. A standing order printed like a
 * kitchen ticket, perforated top and bottom.
 */
export function Ticket({
  title,
  day,
  casesLabel,
  note,
  lines,
  label,
  tilted = false,
}: {
  title: string;
  day?: string;
  casesLabel: string;
  note?: string;
  lines: TicketLine[];
  label?: string;
  tilted?: boolean;
}) {
  return (
    <figure className={`${styles.wrap} ${tilted ? styles.tilted : ""}`} aria-label={label}>
      <div className={styles.ticket}>
        <div className={styles.head}>
          <p className={styles.title}>{title}</p>
          {day ? (
            <p className={styles.day}>
              <LoopMark className={styles.loop} />
              {day}
            </p>
          ) : null}
        </div>
        <table className={styles.lines}>
          <thead>
            <tr>
              <th scope="col" className={styles.qtyHead}>
                {casesLabel}
              </th>
              <th scope="col">
                <span className="visually-hidden">{title}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td className={styles.qty}>{l.cases}</td>
                <td className={styles.item}>
                  <span className={styles.name}>{l.name}</span>
                  {l.summary ? <span className={styles.summary}>{l.summary}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {note ? <figcaption className={styles.note}>{note}</figcaption> : null}
      </div>
    </figure>
  );
}
