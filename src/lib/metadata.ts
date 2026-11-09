import type { Metadata } from "next";
import { site } from "@/config/site";
import { htmlLang, localePath, locales, type Locale } from "./i18n";

/** Canonical URL and language alternates for a page path like "/products". */
export function pageMetadata(
  locale: Locale,
  path: string,
  fields: { title?: string; description?: string } = {},
): Metadata {
  const languages: Record<string, string> = {};
  for (const l of locales) languages[htmlLang[l]] = localePath(l, path);
  languages["x-default"] = localePath("en", path);
  return {
    // Only set what was given, so a layout's title template is never overwritten with undefined.
    ...(fields.title ? { title: fields.title } : {}),
    ...(fields.description ? { description: fields.description } : {}),
    alternates: {
      canonical: localePath(locale, path),
      languages,
    },
    openGraph: {
      title: fields.title ? `${fields.title} | ${site.name}` : site.name,
      description: fields.description,
      url: localePath(locale, path),
      siteName: site.name,
      locale: htmlLang[locale].replace("-", "_"),
      type: "website",
    },
  };
}
