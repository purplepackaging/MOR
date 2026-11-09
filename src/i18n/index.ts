import "server-only";
import type { Locale } from "@/lib/i18n";
import en, { type Dict } from "./en";
import es from "./es";
import tr from "./tr";
import ar from "./ar";

const dictionaries: Record<Locale, Dict> = { en, es, tr, ar };

export function getDictionary(locale: Locale): Dict {
  return dictionaries[locale];
}

export type { Dict };
