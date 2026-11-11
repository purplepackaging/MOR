import type { MetadataRoute } from "next";
import { site } from "@/config/site";
import { productPath } from "@/lib/catalog";
import { htmlLang, localePath, locales } from "@/lib/i18n";
import { getShelf } from "@/lib/shelf";

/** Every public page in every language, with language alternates. Only products that are for sale. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const shelf = await getShelf();
  const paths = [
    "/",
    "/products",
    ...shelf.categories.map((c) => `/products/${c.id}`),
    ...shelf.products.map(productPath),
    // With the portal on, this page only forwards to account creation.
    ...(site.portalEnabled ? [] : ["/request-account"]),
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
