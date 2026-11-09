import { redirect } from "next/navigation";
import { localePath, type Locale } from "@/lib/i18n";

/** The portal home. Until sign-in exists, everyone lands on the sign-in page. */
export default async function AccountPage({ params }: PageProps<"/[locale]/account">) {
  const { locale } = await params;
  redirect(localePath(locale as Locale, "/account/sign-in"));
}
