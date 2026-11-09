import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { preload } from "react-dom";
import "@/styles/tokens.css";
import "@/styles/base.css";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Toaster } from "@/components/Toaster";
import { site } from "@/config/site";
import { getDictionary } from "@/i18n";
import { htmlLang, isLocale, locales, textDir } from "@/lib/i18n";
import { pageMetadata } from "@/lib/metadata";

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dict = getDictionary(locale);
  return {
    metadataBase: new URL(site.url),
    title: {
      default: `${site.name}: ${dict.meta.tagline}`,
      template: `%s | ${site.name}`,
    },
    description: dict.meta.description,
    applicationName: site.name,
    formatDetection: { telephone: false },
    ...pageMetadata(locale, "/", { description: dict.meta.description }),
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  preload("/fonts/readex-pro-latin-wght-normal.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  if (locale === "ar") {
    preload("/fonts/readex-pro-arabic-wght-normal.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  }
  if (locale === "tr") {
    preload("/fonts/readex-pro-latin-ext-wght-normal.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  }

  return (
    <html lang={htmlLang[locale]} dir={textDir(locale)}>
      <body>
        <a className="skip-link" href="#main">
          {dict.nav.skip}
        </a>
        <Header locale={locale} dict={dict} />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <Footer locale={locale} dict={dict} />
        <Toaster />
      </body>
    </html>
  );
}
