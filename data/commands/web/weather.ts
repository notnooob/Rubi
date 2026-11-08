import {defineCommand, fmt, geocode, placeLabel, weatherCode} from "../../../src/sdk"

interface Forecast {
  current: {temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number; wind_speed_10m: number; weather_code: number; is_day: number}
  daily: {time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[]}
}

const f = (c: number) => Math.round((c * 9) / 5 + 32)
const temp = (c: number) => `${Math.round(c)}°C ${fmt.italic(`${f(c)}°F`)}`

export default defineCommand({
  name: "weather",
  aliases: ["w", "forecast"],
  description: "Weather now and the next 3 days: /weather Oslo",
  details: "Data from Open-Meteo (free, no tracking key).",
  category: "Web",
  args: [{name: "place", type: "text", description: "City or place"}],
  examples: ["weather Oslo", "weather New York"],
  live: "🌦 Checking the sky",
  cooldown: 5,
  async run(ctx) {
    const query = ctx.args.place?.trim() || (ctx.isDirect ? (await ctx.contactData.get()).defaultWeather : undefined)
    if (!query) return ctx.usageError("Give a city or place, or set a default with /prefs set weather <place>.")
    const place = await geocode(ctx.http, query)
    ctx.progress(`🌦 Fetching weather for ${placeLabel(place)}`)
    const w = await ctx.http.json<Forecast>("https://api.open-meteo.com/v1/forecast", {
      service: "Open-Meteo",
      query: {
        latitude: place.latitude,
        longitude: place.longitude,
        current: "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day",
        daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
        timezone: "auto",
        forecast_days: 4,
      },
    })
    const c = w.current
    const now = weatherCode(c.weather_code, c.is_day === 1)
    const days = w.daily.time.slice(1, 4).map((day, i) => {
      const d = i + 1
      const wc = weatherCode(w.daily.weather_code[d]!)
      const name = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {weekday: "short", timeZone: "UTC"})
      const rain = w.daily.precipitation_probability_max[d]
      return `${wc.icon} ${fmt.bold(name)} ${Math.round(w.daily.temperature_2m_min[d]!)}…${Math.round(w.daily.temperature_2m_max[d]!)}°C${rain ? ` · 💧${rain}%` : ""}`
    })
    return fmt.lines(
      `${now.icon} ${fmt.bold(placeLabel(place))}`,
      `${temp(c.temperature_2m)} · ${now.text}`,
      `Feels like ${Math.round(c.apparent_temperature)}°C · 💧 ${c.relative_humidity_2m}% · 💨 ${Math.round(c.wind_speed_10m)} km/h`,
      `Today ${Math.round(w.daily.temperature_2m_min[0]!)}…${Math.round(w.daily.temperature_2m_max[0]!)}°C`,
      "",
      ...days,
      ctx.ui.button("\n🔁", "weather", query)
    )
  },
})
