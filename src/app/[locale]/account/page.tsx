import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ToListButton } from "@/components/ToListButton";
import { getDictionary } from "@/i18n";
import { fill, formatDate, localePath, plural, type Locale } from "@/lib/i18n";
import { getOrders, getPortal, getPrices, getUsualOrder, portalReady, setupPath } from "@/lib/portal";
import { signOut, switchAccount } from "./actions";
import { OrdersTable, describe } from "./parts";
import styles from "./account.module.css";

export async function generateMetadata({ params }: PageProps<"/[locale]/account">): Promise<Metadata> {
  const { locale } = await params;
  return { title: getDictionary(locale as Locale).portal.backToAccount, robots: { index: false, follow: false } };
}

/** Portal home: the business, its delivery day, usual order and recent orders. */
export default async function AccountPage({ params }: PageProps<"/[locale]/account">) {
  await connection(); // Always per request: it shows one customer's account.
  const { locale: raw } = await params;
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

  const [prices, usual, orders] = await Promise.all([
    getPrices(account.id),
    getUsualOrder(account.id),
    getOrders(account.id, 5),
  ]);
  const listHref = localePath(locale, "/list");

  return (
    <section className={`container ${styles.page}`}>
      <header className={styles.head}>
        <h1 className="h2">{account.name}</h1>
        <div className={styles.meta}>
          {account.deliveryDay ? (
            <span className={styles.day}>{fill(p.deliveryDay, { day: p.days[account.deliveryDay] })}</span>
          ) : null}
          <p className="muted">{prices ? p.pricesOn : p.pricesSoon}</p>
        </div>
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
        <section className={styles.card} aria-labelledby="usual-title">
          <h2 id="usual-title">{p.usualTitle}</h2>
          {usual ? (
            <>
              <ul className={styles.lines} role="list">
                {usual.lines.slice(0, 8).map((l) => {
                  const d = describe(l.sku, locale, dict);
                  return (
                    <li key={l.sku}>
                      <span>
                        <span className={styles.lineName}>{d.name}</span>
                        <span className={styles.lineMeta}>{d.summary}</span>
                      </span>
                      <span className={styles.qty}>{plural(locale, l.cases, dict.list.cases)}</span>
                    </li>
                  );
                })}
              </ul>
              {usual.lines.length > 8 ? (
                <p className={styles.more}>{plural(locale, usual.lines.length - 8, dict.list.items)} +</p>
              ) : null}
              <p className={styles.more}>{fill(p.usualSaved, { date: formatDate(locale, usual.updatedAt) })}</p>
              <div>
                <ToListButton lines={usual.lines} label={p.usualToList} done={p.usualAdded} href={listHref} />
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

        <section aria-labelledby="recent-title" className={styles.card}>
          <h2 id="recent-title">{p.recentTitle}</h2>
          {orders.length ? (
            <>
              <OrdersTable orders={orders} locale={locale} dict={dict} />
              <p>
                <Link href={localePath(locale, "/account/orders")}>{p.allOrders}</Link>
              </p>
            </>
          ) : (
            <p className="muted">{p.noOrders}</p>
          )}
        </section>
      </div>

      <div className={`${styles.row} ${styles.footer}`}>
        {signOutForm}
        {portal.user.email ? <span className="small muted">{portal.user.email}</span> : null}
      </div>
    </section>
  );
}

