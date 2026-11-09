import Link from "next/link";
import { site } from "@/config/site";
import { localePath, type Locale } from "@/lib/i18n";
import { ContactUs, LegalPage, legalMetadata } from "../LegalPage";

export async function generateMetadata({ params }: PageProps<"/[locale]/sms-terms">) {
  const { locale } = await params;
  return legalMetadata(locale as Locale, "sms");
}

export default async function SmsTermsPage({ params }: PageProps<"/[locale]/sms-terms">) {
  const { locale: raw } = await params;
  const locale = raw as Locale;

  return (
    <LegalPage locale={locale} page="sms">
      <p>
        MOR Supply, a brand of {site.legalName}, sends text messages about customer accounts and orders. These terms
        explain the program.
      </p>

      <h2>What you’ll receive</h2>
      <p>
        Account setup messages, order confirmations and changes, delivery updates and replies to messages you send us.
        Message frequency varies with how often you order.
      </p>

      <h2>How you agree</h2>
      <p>
        You agree to receive texts by checking the box on our account request form or by asking your MOR Supply rep to
        text you. Consent is not a condition of purchase.
      </p>

      <h2>Cost</h2>
      <p>Message and data rates may apply, based on your mobile plan.</p>

      <h2>Stop or get help</h2>
      <ul>
        <li>
          Reply <strong>STOP</strong> to any message to stop receiving texts. We send one message to confirm, then no more.
        </li>
        <li>
          Reply <strong>START</strong> to receive texts again.
        </li>
        <li>
          Reply <strong>HELP</strong> for help.
        </li>
      </ul>

      <h2>Carriers</h2>
      <p>Mobile carriers are not liable for delayed or undelivered messages.</p>

      <h2>Privacy</h2>
      <p>
        We do not share or sell your mobile number or text message consent with third parties or affiliates for marketing
        or promotional purposes. See our <Link href={localePath(locale, "/privacy")}>privacy policy</Link>.
      </p>

      <h2>Contact us</h2>
      <ContactUs site={site} />
    </LegalPage>
  );
}
