import type { MetadataRoute } from "next";
import { site } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/list", "/account", "/es/list", "/es/account", "/tr/list", "/tr/account", "/ar/list", "/ar/account", "/r/"],
    },
    sitemap: `${site.url}/sitemap.xml`,
    host: site.url,
  };
}
