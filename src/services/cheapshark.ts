import type {Http} from "../core/http"
import * as fmt from "../util/format"

/** CheapShark's public, keyless API. Prices are USD and timestamps are Unix seconds. */
export const CHEAPSHARK_API = "https://www.cheapshark.com/api/1.0"
export const CHEAPSHARK_REDIRECT = "https://www.cheapshark.com/redirect?dealID="
const MAX_CAPTION_BYTES = 12_000

export interface CheapSharkSearchResult {
  gameID: string
  external: string
  steamAppID?: string | null
  cheapest?: string
  thumb?: string
}

export interface CheapSharkDeal {
  storeID: string
  dealID: string
  price: string
  retailPrice: string
  savings: string
}

export interface CheapSharkGame {
  info: {
    title: string
    steamAppID?: string | null
    thumb?: string
  }
  cheapestPriceEver?: {
    price: string
    date: number
  }
  deals: CheapSharkDeal[]
}

export interface CheapSharkStore {
  storeID: string
  storeName: string
  isActive: 0 | 1
  images?: {
    banner?: string
    logo?: string
    icon?: string
  }
}

/** Search by title, prefer an exact (case-insensitive) match, then fetch its deals and the store names. */
export async function fetchGameDeals(http: Http, title: string): Promise<{game: CheapSharkGame; stores: Map<string, string>} | undefined> {
  const found = await http.json<CheapSharkSearchResult[]>(`${CHEAPSHARK_API}/games`, {service: "CheapShark", query: {title: title.trim()}})
  const exact = found.find((g) => g.external.toLowerCase() === title.trim().toLowerCase())
  const match = exact ?? found[0]
  if (!match) return undefined

  const [game, storeList] = await Promise.all([
    http.json<CheapSharkGame>(`${CHEAPSHARK_API}/games`, {service: "CheapShark", query: {id: match.gameID}}),
    http.json<CheapSharkStore[]>(`${CHEAPSHARK_API}/stores`, {service: "CheapShark"}),
  ])
  return {game, stores: new Map(storeList.map((s) => [s.storeID, s.storeName]))}
}

/** The redirect URL CheapShark requires API consumers to use (deal ids arrive URL-encoded). */
export const cheapSharkDealUrl = (dealID: string): string => `${CHEAPSHARK_REDIRECT}${dealID}`

/** Every deal tied for the lowest current price, cheapest store names first. */
export function bestCurrentDeals(deals: CheapSharkDeal[], stores: Map<string, string>): CheapSharkDeal[] {
  const prices = deals.map((d) => Number(d.price)).filter(Number.isFinite)
  if (!prices.length) return []
  const best = Math.min(...prices)
  return deals
    .filter((d) => Number(d.price) === best)
    .sort((a, b) => storeName(a, stores).localeCompare(storeName(b, stores)))
}

const storeName = (deal: CheapSharkDeal, stores: Map<string, string>): string => stores.get(deal.storeID) ?? `Store ${deal.storeID}`
const price = (value: string): string => `$${value}`

/** Full game details in one compact SimpleX caption (no review/rating fields are supplied by these endpoints). */
export function renderGameDeals(game: CheapSharkGame, stores: Map<string, string>): string {
  const deals = [...game.deals].sort((a, b) => Number(a.price) - Number(b.price) || storeName(a, stores).localeCompare(storeName(b, stores)))
  const best = new Set(bestCurrentDeals(deals, stores))
  const bestNames = [...best].map((d) => storeName(d, stores))
  const low = game.cheapestPriceEver
  const lowDate = low && Number.isFinite(low.date)
    ? new Date(low.date * 1000).toLocaleDateString("en-US", {day: "numeric", month: "short", year: "numeric", timeZone: "UTC"})
    : undefined

  const lines = [
    `🎮 ${fmt.bold(game.info.title)}`,
    game.info.steamAppID ? `🎗 Steam app id: ${fmt.code(game.info.steamAppID)}` : undefined,
    low ? `📉 Historical low: ${price(low.price)}${lowDate ? ` on ${lowDate}` : ""}` : undefined,
    best.size ? `🏆 Best now: ${price([...best][0]!.price)} at ${bestNames.join(" + ")}` : undefined,
    "",
    deals.length ? fmt.bold(`Current deals (${deals.length}, USD):`) : "No current store deals.",
  ]
  const dealLines = deals.map((d) => {
    const savings = Number(d.savings)
    const discount = Number.isFinite(savings) ? ` · ${fmt.num(savings)}% off` : ""
    return `${best.has(d) ? "🏆 " : "• "}${storeName(d, stores)} — ${price(d.price)} / ${price(d.retailPrice)} retail${discount}\n${cheapSharkDealUrl(d.dealID)}`
  })
  return fitCaption(fmt.lines(...lines, ...dealLines))
}

/**
 * Images can't be split by Messenger. Ordinary CheapShark responses fit comfortably; if an unusual response
 * does not, keep complete deal lines up to the protocol budget rather than imposing a fixed deal-count limit.
 */
function fitCaption(text: string): string {
  if (Buffer.byteLength(text) <= MAX_CAPTION_BYTES) return text
  const lines = text.split("\n")
  const suffix = "… More deals are available on CheapShark."
  let out = ""
  for (const line of lines) {
    const next = out ? `${out}\n${line}` : line
    if (Buffer.byteLength(`${next}\n${suffix}`) > MAX_CAPTION_BYTES) break
    out = next
  }
  return `${out}\n${suffix}`
}
