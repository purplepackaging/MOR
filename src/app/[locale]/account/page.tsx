import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ToListButton } from "@/components/ToListButton";
import { getDictionary } from "@/i18n";
import { fill, formatDate, formatDay, formatDayTime, formatMoney, localePath, plural, type Locale } from "@/lib/i18n";
import {
  getAccountDetails,
  getFees,
  getOrders,
  getPortal,
  getPrices,
  getUsualOrder,
  getWeekly,
  isOwner,
  portalReady,
  setupPath,
} from "@/lib/portal";
import { formatUsPhone } from "@/lib/request-validation";
import { getShelfOrAll } from "@/lib/shelf";
import { setWeekly, signOut, skipWeekly, switchAccount } from "./actions";
import { OrdersTable, describe } from "./parts";
import styles from "./account.module.css";

export async function generateMetadata({ params }: PageProps<"/[locale]/account">): Promise<Metadata> {
  const { locale } = await params;
  return { title: getDictionary(locale as Locale).portal.backToAccount, robots: { index: false, follow: false } };
}

/**
 * Portal home, and where a signed-in customer lands: the usual order first, with
 * what it comes to and one button to order it, then recent orders to order again.
 */
export default async function AccountPage({ params, searchParams }: PageProps<"/[locale]/account">) {
  await connection(); // Always per request: it shows one customer's account.
  const { locale: raw } = await params;
  const { password: passwordNote, details: detailsNote, weekly: weeklyNote } = await searchParams;
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const p = dict.portal;
  const signInPath = localePath(locale, "/account/sign-in");
  if (!portalReady()) redirect(signInPath);
  const portal = await getPortal();
  if (!portal) redirect(`${signInPath}?next=${encodeURIComponent(localePath(locale, "/account"))}`);

  const signOutForm = (
    <form action={signOut}>
      <input type="hidden" name="locale" value={locale} />
      <button type="submit" className="btn btn-quiet">
        {p.signOut}
      </button>
    </form>
  );

  // Passwords are set behind a fresh emailed code, on the sign-in page.
  const passwordLink = (
    <Link href={`${signInPath}?reset=1`}>
      {portal.user.user_metadata?.has_password === true ? p.changePassword : p.setPassword}
    </Link>
  );

  const account = portal.account;
  if (!account) {
    // New here: set up the business first. Switched off: say so.
    if (!portal.paused) redirect(setupPath(locale));
    return (
      <section className={`container ${styles.page}`}>
        <div className={styles.signIn}>
          <h1 className="h2">{p.pausedTitle}</h1>
          <p className="lede">{p.pausedBody}</p>
          {signOutForm}
        </div>
      </section>
    );
  }

  const [prices, usual, orders, shelf, fees, details, owner] = await Promise.all([
    getPrices(account.id),
    getUsualOrder(account.id),
    getOrders(account.id, 5),
    getShelfOrAll(),
    getFees(),
    getAccountDetails(account.id),
    isOwner(account.id, portal.user.id),
  ]);
  const weekly = await getWeekly(account, usual);
  const nextDay = weekly.status === "on" ? formatDay(locale, weekly.next.date) : "";
  // With a delivery day on file, the only thing left to wait for is the first order.
  const weeklyAsked = account.deliveryDay ? p.weeklyAskedDay : p.weeklyAsked;
  // What a change to the weekly order came to, said once at the top of the page.
  const weeklySaid =
    weeklyNote === "failed"
      ? p.weeklyFailed
      : weeklyNote === "off" && weekly.status === "off"
        ? p.weeklyOff
        : weeklyNote === "asked" && weekly.status === "asked"
          ? weeklyAsked
          : weeklyNote === "skipped" && weekly.status === "on" && weekly.skipped
            ? fill(p.weeklySkipped, { date: nextDay, after: formatDay(locale, weekly.after) })
            : (weeklyNote === "asked" || weeklyNote === "unskipped") && weekly.status === "on" && !weekly.skipped
              ? p.weeklyOn
              : null;
  const listHref = localePath(locale, "/list");
  // Only what is for sale goes on the list. The rest stays in the usual order, marked.
  const usualForSale = usual?.lines.filter((l) => shelf.has(l.sku)) ?? [];
  // What the usual order comes to at today's prices, for reading only: the database
  // prices the order again when it is placed.
  const cents = (n: number) => Math.round(n * 100);
  const amountOf = (l: { sku: string; cases: number }) =>
    prices?.[l.sku] != null && shelf.has(l.sku) ? (cents(prices[l.sku]) * l.cases) / 100 : null;
  const usualTotal =
    fees && usualForSale.length && usualForSale.every((l) => amountOf(l) != null)
      ? (usualForSale.reduce((sum, l) => sum + cents(amountOf(l) ?? 0), 0) + cents(fees.delivery)) / 100
      : null;

  return (
    <section className={`container ${styles.page}`}>
      <header className={styles.head}>
        <h1 className="h2">{account.name}</h1>
        {passwordNote === "saved" ? (
          <p className={styles.notice} role="status">
            {p.passwordSaved}
          </p>
        ) : passwordNote === "unsaved" ? (
          <p className={`${styles.notice} ${styles.noticeProblem}`} role="status">
            {p.passwordUnsaved} {passwordLink}
          </p>
        ) : detailsNote === "saved" ? (
          <p className={styles.notice} role="status">
            {p.detailsSaved}
          </p>
        ) : weeklySaid ? (
          <p className={`${styles.notice} ${weeklyNote === "failed" ? styles.noticeProblem : ""}`} role="status">
            {weeklySaid}
          </p>
        ) : null}
        {account.deliveryDay || !prices ? (
          <div className={styles.meta}>
            {account.deliveryDay ? (
              <span className={styles.day}>{fill(p.deliveryDay, { day: p.days[account.deliveryDay] })}</span>
            ) : null}
            {prices ? null : <p className="muted">{p.pricesSoon}</p>}
          </div>
        ) : null}
        {portal.accounts.length > 1 ? (
          <form action={switchAccount} className={styles.switcher}>
            <input type="hidden" name="locale" value={locale} />
            <div className={`field ${styles.field}`}>
              <label className="label" htmlFor="acct-switch">
                {p.switchLabel}
              </label>
              <select id="acct-switch" name="account" className="input" defaultValue={account.id}>
                {portal.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-quiet">
              {p.switch}
            </button>
          </form>
        ) : null}
      </header>

      <div className={styles.grid}>
        <section className={`${styles.card} ${styles.usual}`} aria-labelledby="usual-title">
          <h2 id="usual-title">{p.usualTitle}</h2>
          {usual ? (
            <>
              <ul className={styles.lines} role="list">
                {usual.lines.slice(0, 8).map((l) => {
                  const d = describe(l.sku, locale, dict, shelf);
                  const amount = amountOf(l);
                  return (
                    <li key={l.sku}>
                      <span>
                        <span className={styles.lineName}>{d.name}</span>
                        <span className={styles.lineMeta}>{d.summary}</span>
                        {d.note ? <span className={styles.lineMeta}>{d.note}</span> : null}
                      </span>
                      <span className={styles.lineEnd}>
                        <span className={styles.qty}>{plural(locale, l.cases, dict.list.cases)}</span>
                        {amount != null ? (
                          <span className={styles.lineMeta}>
                            <span className="visually-hidden">{p.lineTotal}: </span>
                            <bdi>{formatMoney(locale, amount)}</bdi>
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {usual.lines.length > 8 ? (
                <p className={styles.more}>{plural(locale, usual.lines.length - 8, dict.list.items)} +</p>
              ) : null}
              {usualTotal != null ? (
                <p className={styles.usualTotal}>
                  <span>{dict.list.totalWithDelivery}</span>
                  <bdi>{formatMoney(locale, usualTotal)}</bdi>
                </p>
              ) : null}
              {usualForSale.length ? (
                <div className={styles.usualAction}>
                  <ToListButton lines={usualForSale} label={p.usualToList} done={p.usualAdded} href={listHref} />
                </div>
              ) : null}
              <p className={styles.more}>
                {fill(p.usualSaved, { date: formatDate(locale, usual.updatedAt) })}. {p.usualChange}
              </p>

              {/* The same order every week: ask for it, skip one delivery, or stop. */}
              <div className={styles.weekly}>
                <h3 className={styles.weeklyTitle}>{p.weeklyTitle}</h3>
                {weekly.status === "off" ? (
                  <>
                    <p className={styles.more}>{p.weeklyOffer}</p>
                    <form action={setWeekly}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="on" value="1" />
                      <button type="submit" className="btn btn-quiet">
                        {weekly.ready ? p.weeklyTurnOn : p.weeklyAsk}
                      </button>
                    </form>
                  </>
                ) : weekly.status === "asked" ? (
                  <>
                    <p className={styles.more}>{weeklyAsked}</p>
                    <form action={setWeekly}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="on" value="0" />
                      <button type="submit" className={styles.textButton}>
                        {p.weeklyCancelAsk}
                      </button>
                    </form>
                  </>
                ) : (
                  <>
                    <p className={styles.weeklyOn}>{p.weeklyOn}</p>
                    <p className={styles.more}>
                      {weekly.skipped
                        ? fill(p.weeklySkipped, { date: nextDay, after: formatDay(locale, weekly.after) })
                        : `${fill(p.weeklyNext, { date: nextDay, closes: formatDayTime(locale, weekly.next.closesAt) })} ${p.weeklyChangeHint}`}
                    </p>
                    <div className={styles.row}>
                      <form action={skipWeekly}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="skip" value={weekly.skipped ? "0" : "1"} />
                        <button type="submit" className="btn btn-quiet">
                          {weekly.skipped ? p.weeklyUnskip : fill(p.weeklySkip, { date: nextDay })}
                        </button>
                      </form>
                      <form action={setWeekly}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="on" value="0" />
                        <button type="submit" className={styles.textButton}>
                          {p.weeklyTurnOff}
                        </button>
                      </form>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="muted">{p.usualEmpty}</p>
              <div>
                <Link className="btn" href={localePath(locale, "/products")}>
                  {dict.list.browse}
                </Link>
              </div>
            </>
          )}
        </section>

        <section aria-labelledby="recent-title" className={`${styles.card} ${styles.recent}`}>
          <h2 id="recent-title">{p.recentTitle}</h2>
          {orders.length ? (
            <>
              <OrdersTable orders={orders} locale={locale} dict={dict} shelf={shelf} />
              <p>
                <Link href={localePath(locale, "/account/orders")}>{p.allOrders}</Link>
              </p>
            </>
          ) : (
            <p className="muted">{p.noOrders}</p>
          )}
        </section>

        {/* Where we deliver and whom we call. The owner can correct it; staff who only order can read it. */}
        {details ? (
          <section aria-labelledby="business-title" className={`${styles.card} ${styles.business}`}>
            <h2 id="business-title">{p.businessTitle}</h2>
            <address className={styles.address}>
              <span className={styles.lineName}>{details.name}</span>
              <span>{details.street}</span>
              <span>
                {details.city} <bdi>{details.zip}</bdi>
              </span>
              <span>
                {details.contactName}
                {details.phone ? (
                  <>
                    {", "}
                    <bdi>{formatUsPhone(details.phone)}</bdi>
                  </>
                ) : null}
              </span>
            </address>
            {owner ? (
              <p>
                <Link href={localePath(locale, "/account/details")}>{p.editDetails}</Link>
              </p>
            ) : (
              <p className={styles.more}>{p.detailsOwnerOnly}</p>
            )}
          </section>
        ) : null}
      </div>

      {prices ? <p className={`small muted ${styles.aside}`}>{p.pricesOn}</p> : null}

      <div className={`${styles.row} ${styles.footer}`}>
        {signOutForm}
        {portal.user.email ? <span className="small muted">{portal.user.email}</span> : null}
        <span className={`small ${styles.footerLink}`}>{passwordLink}</span>
      </div>
    </section>
  );
}

