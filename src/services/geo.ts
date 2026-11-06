import type {Http} from "../core/http"
import {CommandError} from "../core/errors"

/** Place lookup via Open-Meteo's free geocoding API (no key). */
export interface Place {
  name: string
  country?: string
  admin1?: string
  latitude: number
  longitude: number
  timezone: string
}

export function placeLabel(p: Place): string {
  return [p.name, p.admin1 && p.admin1 !== p.name ? p.admin1 : undefined, p.country].filter(Boolean).join(", ")
}

export async function geocode(http: Http, query: string): Promise<Place> {
  const res = await http.json<{results?: Place[]}>("https://geocoding-api.open-meteo.com/v1/search", {
    service: "Geocoding",
    query: {name: query.trim(), count: 1, language: "en", format: "json"},
  })
  const p = res.results?.[0]
  if (!p) throw new CommandError(`I couldn't find a place called "${query}".`)
  return p
}

/** Is this an IANA time zone name Node understands (e.g. "Europe/Berlin", "UTC")? */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", {timeZone: tz})
    return true
  } catch {
    return false
  }
}

/** WMO weather codes (Open-Meteo) → emoji + text. */
export function weatherCode(code: number, isDay = true): {icon: string; text: string} {
  const m: Record<number, [string, string]> = {
    0: [isDay ? "☀️" : "🌙", "Clear sky"],
    1: [isDay ? "🌤" : "🌙", "Mainly clear"],
    2: ["⛅", "Partly cloudy"],
    3: ["☁️", "Overcast"],
    45: ["🌫", "Fog"],
    48: ["🌫", "Rime fog"],
    51: ["🌦", "Light drizzle"],
    53: ["🌦", "Drizzle"],
    55: ["🌧", "Dense drizzle"],
    56: ["🌧", "Freezing drizzle"],
    57: ["🌧", "Freezing drizzle"],
    61: ["🌦", "Light rain"],
    63: ["🌧", "Rain"],
    65: ["🌧", "Heavy rain"],
    66: ["🌧", "Freezing rain"],
    67: ["🌧", "Freezing rain"],
    71: ["🌨", "Light snow"],
    73: ["🌨", "Snow"],
    75: ["❄️", "Heavy snow"],
    77: ["🌨", "Snow grains"],
    80: ["🌦", "Rain showers"],
    81: ["🌧", "Rain showers"],
    82: ["⛈", "Violent rain showers"],
    85: ["🌨", "Snow showers"],
    86: ["❄️", "Heavy snow showers"],
    95: ["⛈", "Thunderstorm"],
    96: ["⛈", "Thunderstorm with hail"],
    99: ["⛈", "Thunderstorm with hail"],
  }
  const [icon, text] = m[code] ?? ["🌡", "Unknown"]
  return {icon, text}
}

/** "UTC+5:30" for a time zone at a given instant. */
export function utcOffset(timeZone: string, at = Date.now()): string {
  const name = new Intl.DateTimeFormat("en-US", {timeZone, timeZoneName: "shortOffset"}).formatToParts(at).find((p) => p.type === "timeZoneName")?.value
  return (name ?? "GMT").replace("GMT", "UTC").replace(/^UTC$/, "UTC±0")
}
