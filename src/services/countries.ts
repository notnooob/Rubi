import countries from "world-countries"

/**
 * Offline country data (mledoze/countries via the `world-countries` package, ODbL).
 * No API, no key, no network — REST Countries now needs an API key, so Rubi ships the data instead.
 */
export type Country = (typeof countries)[number]

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()

/** Find a country by name, official name, alternative spelling ("UK"), or ISO code ("de", "usa"). */
export function findCountry(query: string): Country | undefined {
  const q = norm(query)
  if (!q) return undefined
  const exact = countries.find(
    (c) =>
      norm(c.cca2) === q ||
      norm(c.cca3) === q ||
      norm(c.name.common) === q ||
      norm(c.name.official) === q ||
      c.altSpellings.some((a) => norm(a) === q)
  )
  if (exact) return exact
  // then a name that starts with / contains the query (largest country first, so "congo" isn't random)
  const partial = countries
    .filter((c) => norm(c.name.common).startsWith(q) || norm(c.name.common).includes(q) || norm(c.name.official).includes(q))
    .sort((a, b) => b.area - a.area)
  return partial[0]
}

export function countryByCode(cca3: string): Country | undefined {
  return countries.find((c) => c.cca3 === cca3)
}
