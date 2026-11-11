import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { normalizeRepCode, repDisplayName } from "@/config/reps";
import { REP_COOKIE } from "@/config/site";
import { getDictionary } from "@/i18n";
import { localePath, type Locale } from "@/lib/i18n";
import { getPortal, portalReady, safeNext, setupPath } from "@/lib/portal";
import { SetupForm } from "./SetupForm";
import setup from "./setup.module.css";

export async function generateMetadata({ params }: PageProps<"/[locale]/account/setup">): Promise<Metadata> {
  const { locale } = await params;
  return { title: getDictionary(locale as Locale).setup.title, robots: { index: false, follow: false } };
}

/** First sign-in: the person tells us about their business, then orders. */
export default async function SetupPage({ params, searchParams }: PageProps<"/[locale]/account/setup">) {
  await connection(); // Always per request: it depends on who is signed in.
  const { locale: raw } = await params;
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const query = await searchParams;
  const next = safeNext(query.next);
  const signIn = localePath(locale, "/account/sign-in");
  if (!portalReady()) redirect(signIn);
  const portal = await getPortal();
  if (!portal) redirect(`${signIn}?next=${encodeURIComponent(setupPath(locale, next))}`);
  if (portal.account || portal.paused) redirect(next ?? localePath(locale, "/account"));

  // Flyer QR codes go through /r/CODE, which saves the rep in a cookie and in ?rep=.
  const fromQuery = typeof query.rep === "string" ? normalizeRepCode(query.rep) : "";
  const repCode = fromQuery || normalizeRepCode((await cookies()).get(REP_COOKIE)?.value);
  const rep = repCode ? { code: repCode, name: repDisplayName(repCode) } : null;

  return (
    <div className={`container ${setup.page}`} data-one-job>
      <div className={setup.column}>
        <SetupForm
          locale={locale}
          next={next}
          email={portal.user.email ?? ""}
          rep={rep}
          t={dict.setup}
          r={dict.request}
          hrefs={{ sms: localePath(locale, "/sms-terms"), privacy: localePath(locale, "/privacy") }}
        />
      </div>
    </div>
  );
}
