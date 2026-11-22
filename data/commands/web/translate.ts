import {decodeEntities} from "../../../src/services/reddit"
import {defineCommand, fmt} from "../../../src/sdk"

/** MyMemory's per-request limit ("MAX ALLOWED QUERY : 500 CHARS"). */
export const MAX_CHARS = 500

/** Common language names → the codes MyMemory expects (it takes ISO 639 codes, optionally with a region). */
const NAMES: Record<string, string> = {
  english: "en", german: "de", deutsch: "de", french: "fr", spanish: "es", italian: "it", portuguese: "pt", dutch: "nl",
  russian: "ru", ukrainian: "uk", polish: "pl", czech: "cs", slovak: "sk", romanian: "ro", hungarian: "hu", bulgarian: "bg",
  greek: "el", turkish: "tr", arabic: "ar", hebrew: "he", persian: "fa", farsi: "fa", hindi: "hi", bengali: "bn", urdu: "ur",
  chinese: "zh-CN", mandarin: "zh-CN", japanese: "ja", korean: "ko", vietnamese: "vi", thai: "th", indonesian: "id",
  malay: "ms", swedish: "sv", norwegian: "no", danish: "da", finnish: "fi", icelandic: "is", estonian: "et", latvian: "lv",
  lithuanian: "lt", croatian: "hr", serbian: "sr", slovenian: "sl", catalan: "ca", basque: "eu", galician: "gl", irish: "ga",
  welsh: "cy", esperanto: "eo", latin: "la", swahili: "sw", filipino: "tl", tagalog: "tl", afrikaans: "af",
}

/** "de", "pt-BR", "german" → a language code, or undefined. */
export function languageCode(input: string): string | undefined {
  const s = input.trim().toLowerCase()
  if (NAMES[s]) return NAMES[s]
  const m = s.match(/^([a-z]{2,3})(?:-([a-z]{2,4}))?$/)
  if (!m) return undefined
  return m[2] ? `${m[1]}-${m[2].length === 2 ? m[2].toUpperCase() : m[2][0]!.toUpperCase() + m[2].slice(1)}` : m[1]
}

/** "de" or "fr>en" (also "fr:en", "fr-en" isn't accepted since it's a region code). */
export function parseLanguages(input: string): {from?: string; to: string} | undefined {
  const parts = input.split(/>|→|:/)
  if (parts.length > 2) return undefined
  const to = languageCode(parts[parts.length - 1]!)
  if (!to) return undefined
  if (parts.length === 1) return {to}
  const from = languageCode(parts[0]!)
  return from ? {from, to} : undefined
}

interface MyMemoryResponse {
  responseData?: {translatedText?: string; detectedLanguage?: string}
  responseStatus?: number | string
  responseDetails?: string
  quotaFinished?: boolean | null
}

export default defineCommand({
  name: "translate",
  aliases: ["tr"],
  description: "Translate text: /translate de good morning",
  details:
    "Give the target language (a code like de or pt-BR, or a name like german), then the text — or reply to a message with " +
    "/translate de. The source language is detected; name it with fr>en if the guess is wrong. Up to 500 characters per translation. " +
    "The text is sent to MyMemory (translated.net) to be translated.",
  category: "Web",
  args: [
    {name: "lang", type: "string", description: "Target language, or source>target", required: true},
    {name: "text", type: "text", description: "Text to translate (or reply to a message)"},
  ],
  examples: ["translate de good morning", "translate fr>en bonjour tout le monde", "translate japanese thank you"],
  live: "🌍 Translating",
  cooldown: 5,
  async run(ctx) {
    const langs = parseLanguages(ctx.args.lang)
    if (!langs) return ctx.usageError(`"${ctx.args.lang}" isn't a language I know. Use a code like de, es or pt-BR, or source>target like fr>en.`)
    const text = (ctx.args.text ?? ctx.quotedText)?.trim()
    if (!text) return ctx.usageError("Give the text to translate, or reply to a message with /translate <language>.")
    // UTF-16 length: never less than what MyMemory counts
    if (text.length > MAX_CHARS) return ctx.usageError(`That's too long to translate at once (${text.length} characters, ${MAX_CHARS} at most).`)
    if (langs.from && langs.from === langs.to) return ctx.usageError("Pick two different languages.")

    const res = await ctx.http.json<MyMemoryResponse>("https://api.mymemory.translated.net/get", {
      service: "The translation service",
      query: {q: text, langpair: `${langs.from ?? "Autodetect"}|${langs.to}`, de: ctx.config.http.translateEmail},
    })
    const status = Number(res.responseStatus)
    const out = decodeEntities(res.responseData?.translatedText ?? "").trim()
    if (res.quotaFinished || /^MYMEMORY WARNING/i.test(out)) return ctx.fail("The translation service's free daily quota is used up. Try again tomorrow.")
    if (status !== 200 || !out) {
      const why = res.responseDetails?.trim() || out
      const hint = langs.from ? "" : ` If it couldn't tell the language, name it: ${ctx.ui.cmd("translate", `fr>${langs.to} …`)}`
      return ctx.fail(`The translation service couldn't translate that${why ? ` (${fmt.truncate(why.toLowerCase(), 150)})` : ""}.${hint}`)
    }
    const detected = langs.from ?? res.responseData?.detectedLanguage
    return fmt.lines(`🌍 ${fmt.bold(`${detected ? `${detected} → ` : ""}${langs.to}`)}`, out, fmt.italic("via MyMemory"))
  },
})
