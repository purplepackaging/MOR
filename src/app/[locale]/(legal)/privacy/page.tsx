import Link from "next/link";
import { site } from "@/config/site";
import { localePath, type Locale } from "@/lib/i18n";
import { ContactUs, LegalPage, legalMetadata } from "../LegalPage";

export async function generateMetadata({ params }: PageProps<"/[locale]/privacy">) {
  const { locale } = await params;
  return legalMetadata(locale as Locale, "privacy");
}

export default async function PrivacyPage({ params }: PageProps<"/[locale]/privacy">) {
  const { locale: raw } = await params;
  const locale = raw as Locale;

  return (
    <LegalPage locale={locale} page="privacy">
      <p>
        MOR Supply is a brand of {site.legalName} (“we,” “us”). This policy explains what we collect when you visit
        morsupply.com, request an account, order from us or text with us, and how we use it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>What you tell us:</strong> your business name and type, your name, mobile number, email, delivery
          address, preferred language, rep code, how you like to order, your notes and the products on your list.
        </li>
        <li>
          <strong>Text message consent:</strong> whether you agreed to receive texts from us, the exact wording you agreed
          to and when.
        </li>
        <li>
          <strong>Device information:</strong> when you send a form, we record your IP address and browser type. We use it
          to prevent abuse and to keep a record of your consent.
        </li>
        <li>
          <strong>Payments:</strong> when you pay online, your card or bank details go straight to Stripe, our payment
          processor, and never to us. We keep how you paid (bank account, credit card or debit card), the amount, any
          card fee and the date.
        </li>
        <li>
          <strong>Cookies and storage:</strong> one cookie remembers your language and one remembers the rep whose flyer
          you scanned. Your list is kept in your browser’s storage on your device until you send it. On the pay page,
          Stripe sets its own cookies to prevent fraud. We do not use advertising cookies.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To review your request and set up your account.</li>
        <li>To contact you about your account, prices, orders and deliveries.</li>
        <li>To deliver your orders and, once online ordering opens, to take payments.</li>
        <li>To improve our products and service, and to meet our legal obligations.</li>
      </ul>

      <h2>Who we share it with</h2>
      <p>
        We share information only with your MOR Supply sales rep and with service providers that host our website, store
        our data, send our text messages and process payments, and only so they can provide that service to us. We may
        also share information when the law requires it. We do not sell personal information.
      </p>
      <p>
        <strong>
          We do not share or sell mobile numbers or text message opt-in data and consent with third parties or
          affiliates for marketing or promotional purposes.
        </strong>{" "}
        Text message opt-in data is shared only with the providers that deliver our messages.
      </p>

      <h2>Text messages</h2>
      <p>
        If you agree to texts, we send messages about your account and orders. Reply STOP to stop at any time. See our{" "}
        <Link href={localePath(locale, "/sms-terms")}>text message terms</Link>.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep account information while your account is open and afterward as long as we need it for business records
        and legal obligations. We delete account requests that do not become accounts once we no longer need them.
      </p>

      <h2>Your choices</h2>
      <p>
        You can ask us to show you, correct or delete the information we have about you. Some information we must keep,
        such as invoices and consent records.
      </p>

      <h2>Security</h2>
      <p>
        We limit who can see your information and use service providers that protect data in transit and at rest. No
        system is perfectly secure, so we cannot promise that information will never be exposed.
      </p>

      <h2>For businesses</h2>
      <p>MOR Supply sells to businesses. Our site and services are not meant for children.</p>

      <h2>Changes</h2>
      <p>When we change this policy, we update the date at the top of this page.</p>

      <h2>Contact us</h2>
      <ContactUs site={site} />
    </LegalPage>
  );
}
