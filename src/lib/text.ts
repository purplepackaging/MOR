/** Lowercase and strip accents so "Charola", "charola" and "chárola" match. */
export function normalize(s: string): string {
  return s
    .toLocaleLowerCase("en-US")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function matchesQuery(haystack: string, query: string): boolean {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  return tokens.every((t) => haystack.includes(t));
}
