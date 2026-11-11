import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary } from "@/i18n";
import { isLocale } from "@/lib/i18n";

export async function generateMetadata({ params }: PageProps<"/[locale]/[...rest]">): Promise<Metadata> {
  const { locale } = await params;
  return { title: getDictionary(isLocale(locale) ? locale : "en").notFound.title };
}

/** Any unknown path inside a language renders that language's 404. */
export default function CatchAll() {
  notFound();
}
