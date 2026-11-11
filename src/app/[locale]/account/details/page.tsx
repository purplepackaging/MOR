import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getDictionary } from "@/i18n";
import { localePath, type Locale } from "@/lib/i18n";
import { getAccountDetails, getPortal, isOwner, portalReady } from "@/lib/portal";
import { formatUsPhone } from "@/lib/request-validation";
import { DetailsForm } from "./DetailsForm";
import setup from "../setup/setup.module.css";

export async function generateMetadata({ params }: PageProps<"/[locale]/account/details">): Promise<Metadata> {
  const { locale } = await params;
  return { title: getDictionary(locale as Locale).portal.detailsTitle, robots: { index: false, follow: false } };
}

/** The owner of a business corrects its name, address, contact and language. */
export default async function DetailsPage({ params }: PageProps<"/[locale]/account/details">) {
  await connection(); // Always per request: it shows one customer's business.
  const { locale: raw } = await params;
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const p = dict.portal;
  const account = localePath(locale, "/account");
  const signIn = localePath(locale, "/account/sign-in");
  if (!portalReady()) redirect(signIn);
  const portal = await getPortal();
  if (!portal) redirect(`${signIn}?next=${encodeURIComponent(localePath(locale, "/account/details"))}`);
  if (!portal.account) redirect(account);

  const [details, owner] = await Promise.all([
    getAccountDetails(portal.account.id),
    isOwner(portal.account.id, portal.user.id),
  ]);
  // Staff who only order see the details on the account page and cannot change them.
  if (!details || !owner) redirect(account);

  return (
    <div className={`container ${setup.page}`} data-one-job>
      <div className={setup.column}>
        <DetailsForm
          locale={locale}
          details={{
            businessName: details.name,
            street: details.street,
            city: details.city,
            zip: details.zip,
            contactName: details.contactName,
            phone: details.phone ? formatUsPhone(details.phone) : "",
            language: details.language,
          }}
          backHref={account}
          labels={{
            title: p.detailsTitle,
            lede: p.detailsLede,
            save: p.detailsSave,
            saving: dict.setup.saving,
            failed: p.detailsFailed,
            back: p.backToAccount,
            phoneHint: dict.setup.phoneHint,
          }}
          r={dict.request}
        />
      </div>
    </div>
  );
}
