/**
 * Text as search compares it: lowercase, no accents, and every run of anything that is not a letter or a
 * digit turned into one space. "Charola", "charola" and "chárola" match, and so do "to-go" and "to go".
 */
export function normalize(s: string): string {
  return s
    .toLocaleLowerCase("en-US")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Does one typed word find this text? A word in Latin letters or digits has to start a word of the text, so
 * "pan" finds "foil pans" and not "Spanish", and "cup" finds "cups". Other scripts match anywhere, because
 * Arabic joins "the" to the front of a word.
 */
function finds(text: string, token: string): boolean {
  return /^[a-z0-9]+$/.test(token) ? ` ${text}`.includes(` ${token}`) : text.includes(token);
}

/** `haystack` is text that went through `normalize`. Every word of the query has to find it. */
export function matchesQuery(haystack: string, query: string): boolean {
  const tokens = normalize(query).split(" ").filter(Boolean);
  return tokens.every((t) => finds(haystack, t));
}

/** 0 when the product's own name answers the whole query, 1 when only its sizes, material or other words do. */
export function nameRank(name: string, query: string): 0 | 1 {
  return matchesQuery(normalize(name), query) ? 0 : 1;
}
