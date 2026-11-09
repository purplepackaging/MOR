import type { MetadataRoute } from "next";
import { site } from "@/config/site";
import { getCategories, getProducts, productPath } from "@/lib/catalog";
import { htmlLang, localePath, locales } from "@/lib/i18n";

/** Every public page in every language, with language alternates. */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    "/",
    "/products",
    ...getCategories().map((c) => `/products/${c.id}`),
    ...getProducts().map(productPath),
    "/request-account",
    "/privacy",
    "/terms",
    "/sms-terms",
  ];
  const abs = (p: string) => new URL(p, site.url).toString();

  return paths.flatMap((path) => {
    const languages = Object.fromEntries(locales.map((l) => [htmlLang[l], abs(localePath(l, path))]));
    return locales.map((locale) => ({
      url: abs(localePath(locale, path)),
      changeFrequency: path.startsWith("/products") || path === "/" ? ("weekly" as const) : ("yearly" as const),
      priority: path === "/" ? 1 : path.startsWith("/products") ? 0.8 : 0.4,
      alternates: { languages },
    }));
  });
}
