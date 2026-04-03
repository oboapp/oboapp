/**
 * Address normalization for geocoding cache keys.
 *
 * Produces stable, lowercase, whitespace-normalized strings used as
 * lookup keys in the geocode cache collections. The same normalization
 * must be applied consistently at both write time (CLI pre-cache script)
 * and read time (in-memory cache loader and API routes).
 *
 * Both pin addresses and street names use `normalizePinAddress` as their
 * cache key. Streets are keyed by their name alone (not by section endpoints)
 * because the cache stores the full street geometry — any intersection
 * involving that street can then be computed locally.
 */

/**
 * Normalize an address or street name to a geocoding cache key.
 *
 * Lowercases, strips street-type prefixes, removes ordinal suffixes,
 * strips quotes, and collapses whitespace.
 */
export function normalizePinAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/^(бул\.|ул\.|площад|пл\.)\s*/, "")
    .replaceAll(
      /(?<=\d)-(?:ти|та|ви|ва|ри|ра|ми|ма|то|и)(?=\s|$|[^а-яa-z])/gi,
      "",
    )
    .replaceAll(/["\u201c\u201d\u201e'`\u2018\u2019\u201a«»\u2039\u203a]/g, "")
    .replaceAll(/\.([а-яa-z])/gi, ". $1")
    .replaceAll(/\s+/g, " ")
    .trim();
}
