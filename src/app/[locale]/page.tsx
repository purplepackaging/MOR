import Link from "next/link";
import { Plus } from "lucide-react";
import { IntentLink } from "@/components/IntentLink";
import { ProductCard } from "@/components/ProductCard";
import { ProductVisual } from "@/components/ProductVisual";
import { SessionLink, SessionText } from "@/components/SessionSwap";
import { Ticket } from "@/components/Ticket";
import { site } from "@/config/site";
import { getDictionary } from "@/i18n";
import { cardPriceLabels, categoryHref, productCard } from "@/lib/catalog";
import { fill, formatMoney, formatNumber, localePath, plural, type Locale } from "@/lib/i18n";
import { getShelf, sampleOrder } from "@/lib/shelf";
import styles from "./home.module.css";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const locale = (await params).locale as Locale;
  const dict = getDictionary(locale);
  const h = dict.home;
  // Signed-in customers get a way back to their account where visitors are asked to create one.
  const account = { href: localePath(locale, "/account"), label: dict.nav.account };
  const shelf = await getShelf();
  const { categories, products, staples } = shelf;
  const order = sampleOrder(shelf, locale);
  // Three tiles across on wide screens, or four when that fills the last row better
  // (eight categories make two rows of four, not three, three and two).
  const cardPrices = cardPriceLabels(locale, dict);
  const n = categories.length;
  const catColumns = n % 3 === 0 ? 3 : n % 4 === 0 || n % 3 === 1 ? 4 : 3;
  const surcharge = formatNumber(locale, site.cardSurchargePercent);
  const delivery = formatMoney(locale, site.deliveryFee);
  const nextDay = formatMoney(locale, site.nextDayFee);

  return (
    <>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={`container ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            <h1 id="hero-title" className="display">
              {titleLines(h.title).map((line, i) => (
                <span key={i} className={styles.titleLine}>
                  {i > 0 ? " " : null}
                  {line}
                </span>
              ))}
            </h1>
            <p className="lede">{h.lede}</p>
            <div className={styles.ctas}>
              <Link className="btn" href={localePath(locale, "/products")}>
                {h.browse}
              </Link>
              <SessionLink
                className="btn btn-quiet"
                portal={site.portalEnabled}
                signedOut={{ href: localePath(locale, "/request-account"), label: h.request }}
                signedIn={account}
              />
            </div>
          </div>

          <div className={styles.artWrap}>
            <div className={styles.art}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className={`${styles.cut} ${styles.cutKebab}`}
                src="/img/hero/adana.webp"
                alt=""
                width={760}
                height={596}
                fetchPriority="high"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className={`${styles.cut} ${styles.cutTacos}`}
                src="/img/hero/tacos.webp"
                alt=""
                width={747}
                height={760}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className={`${styles.cut} ${styles.cutSalad}`}
                src="/img/hero/salad-bowl.webp"
                alt=""
                width={760}
                height={644}
              />
            </div>
            {order.length ? (
              <div className={styles.ticketSlot}>
                <Ticket
                  tilted
                  label={h.ticketLabel}
                  title={h.ticketTitle}
                  day={h.ticketDay}
                  casesLabel={h.ticketCases}
                  note={h.ticketNote}
                  lines={order
                    .slice(0, 4)
                    .map((l) => ({ key: l.sku, cases: l.cases, name: l.name, summary: l.summary }))}
                />
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="carry-title">
        <div className="container">
          <div className="section-head">
            <div>
              <h2 id="carry-title" className="h2">
                {h.carryTitle}
              </h2>
              <p className="muted">
                {fill(h.carryBody, {
                  n: formatNumber(locale, products.length),
                  c: formatNumber(locale, categories.length),
                })}
              </p>
            </div>
            <Link className="link" href={localePath(locale, "/products")}>
              {h.carryAll}
            </Link>
          </div>
          <ul role="list" className={styles.cats} data-columns={catColumns}>
            {categories.map((c) => {
              const count = products.filter((p) => p.category === c.id).length;
              return (
                <li key={c.id}>
                  <IntentLink href={categoryHref(locale, c.id)} className={styles.cat}>
                    <ProductVisual image={c.image} icon={c.icon} className={styles.catTile} />
                    <span className={styles.catText}>
                      <h3 className={styles.catName}>{c.name[locale]}</h3>
                      <span className={styles.catCount}>{plural(locale, count, h.categoryCount)}</span>
                    </span>
                  </IntentLink>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section id="how" className={`section ${styles.how}`} aria-labelledby="how-title">
        <div className="container">
          <h2 id="how-title" className="h2">
            {h.howTitle}
          </h2>
          <ol role="list" className={styles.steps}>
            {h.steps.map((s, i) => (
              <li key={s.title} className={styles.step}>
                <span className={styles.stepNum} aria-hidden="true">
                  {formatNumber(locale, i + 1)}
                </span>
                <h3 className="h3">{s.title}</h3>
                <p className="muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {staples.length ? (
        <section className="section" aria-labelledby="staples-title">
          <div className="container">
            <div className="section-head">
              <div>
                <h2 id="staples-title" className="h2">
                  {h.staplesTitle}
                </h2>
                <p className="muted">{h.staplesBody}</p>
              </div>
            </div>
            <ul role="list" className={styles.staples}>
              {staples.map((p) => (
                <li key={p.slug}>
                  <ProductCard card={productCard(p, locale, dict)} prices={cardPrices} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section className={`section ${styles.faqSection}`} aria-labelledby="faq-title">
        <div className={`container ${styles.faqGrid}`}>
          <h2 id="faq-title" className="h2">
            {h.faqTitle}
          </h2>
          <div className={styles.faq}>
            {h.faq.map((item) => (
              <details key={item.q} className={styles.qa}>
                <summary>
                  <span>{item.q}</span>
                  <Plus aria-hidden="true" className={styles.qaIcon} />
                </summary>
                <p>{fill(item.a, { surcharge, delivery, nextDay })}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.ctaSection} aria-labelledby="cta-title">
        <div className="container">
          <div className={styles.cta}>
            <div>
              <h2 id="cta-title" className="h2">
                <SessionText portal={site.portalEnabled} signedOut={h.ctaTitle} signedIn={h.ctaTitleSignedIn} />
              </h2>
              <p>
                <SessionText portal={site.portalEnabled} signedOut={h.ctaBody} signedIn={h.ctaBodySignedIn} />
              </p>
            </div>
            <SessionLink
              className="btn btn-light"
              portal={site.portalEnabled}
              signedOut={{ href: localePath(locale, "/request-account"), label: h.ctaButton }}
              signedIn={{ href: account.href, label: h.ctaButtonSignedIn }}
            />
          </div>
        </div>
      </section>
    </>
  );
}

/** "Your usual order, on repeat." → two phrases, so wide screens can set one per line. */
function titleLines(title: string): string[] {
  const m = title.match(/^(.+?[,،])\s+(.+)$/);
  return m ? [m[1], m[2]] : [title];
}
