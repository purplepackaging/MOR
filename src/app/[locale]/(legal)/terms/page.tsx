import { site } from "@/config/site";
import type { Locale } from "@/lib/i18n";
import { ContactUs, LegalPage, legalMetadata } from "../LegalPage";

export async function generateMetadata({ params }: PageProps<"/[locale]/terms">) {
  const { locale } = await params;
  return legalMetadata(locale as Locale, "terms");
}

export default async function TermsPage({ params }: PageProps<"/[locale]/terms">) {
  const { locale: raw } = await params;
  const locale = raw as Locale;

  return (
    <LegalPage locale={locale} page="terms">
      <p>
        These terms apply to every order you place with MOR Supply, a brand of {site.legalName}, whether you order
        online, by text, on WhatsApp or through your sales rep.
      </p>

      <h2>Accounts</h2>
      <p>
        We sell to businesses. You need an account to order. We may decline a request or close an account, for example
        for unpaid invoices.
      </p>

      <h2>Prices</h2>
      <p>
        Prices are set for your account and confirmed by your rep before your first order. Prices can change. Your
        invoice shows the price for each order.
      </p>

      <h2>Your order guide</h2>
      <p>
        Your order guide repeats on your delivery day until you change, skip or pause it. Make changes before the cutoff
        your rep confirms for your route. If an item is out of stock, we tell you and may offer a comparable item.
      </p>

      <h2>Delivery</h2>
      <p>
        We deliver on your scheduled day to the address on your account. Please check your delivery when it arrives and
        tell us right away about missing or damaged items.
      </p>

      <h2>Payment</h2>
      <ul>
        <li>Bank payments (ACH) have no fee.</li>
        <li>Debit cards have no fee.</li>
        <li>
          Credit cards have a {site.cardSurchargePercent}% surcharge. It is shown before you pay and is never more than
          what card acceptance costs us.
        </li>
        <li>Apple Pay and Google Pay are charged the same as the card you use with them.</li>
      </ul>
      <p>Payment is due on the terms set for your account.</p>

      <h2>Product details</h2>
      <p>
        Sizes, materials and case counts on this site are for reference and can change with our suppliers. Your rep
        confirms the details of anything you order.
      </p>

      <h2>Limits on liability</h2>
      <p>
        To the extent the law allows, our responsibility for any order is limited to the amount you paid for the products
        involved.
      </p>

      <h2>Changes</h2>
      <p>When we change these terms, we update the date at the top of this page. Orders follow the terms in place when they are placed.</p>

      <h2>Contact us</h2>
      <ContactUs site={site} />
    </LegalPage>
  );
}
