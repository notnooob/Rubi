import {defineCommand, fmt, HttpError} from "../../../src/sdk"

interface Entry {
  word: string
  phonetic?: string
  meanings: {partOfSpeech: string; definitions: {definition: string; example?: string}[]; synonyms?: string[]}[]
}

export default defineCommand({
  name: "define",
  aliases: ["dict", "dictionary"],
  description: "Dictionary definition: /define serendipity",
  category: "Web",
  args: [{name: "word", type: "text", description: "English word", required: true}],
  examples: ["define serendipity"],
  live: "📖 Looking it up",
  cooldown: 5,
  async run(ctx) {
    const word = ctx.args.word.trim().toLowerCase()
    let entries: Entry[]
    try {
      entries = await ctx.http.json<Entry[]>(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {service: "The dictionary"})
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return ctx.fail(`No definition found for "${word}".`)
      throw e
    }
    const e = entries[0]
    if (!e) return ctx.fail(`No definition found for "${word}".`)
    const meanings = e.meanings.slice(0, 3).map((m) => {
      const defs = m.definitions.slice(0, 2).map((d, i) => `${i + 1}. ${d.definition}${d.example ? `\n   ${fmt.italic(`“${d.example}”`)}` : ""}`)
      const syn = m.synonyms?.length ? `\n   ${fmt.italic(`≈ ${m.synonyms.slice(0, 5).join(", ")}`)}` : ""
      return `${fmt.italic(m.partOfSpeech)}\n${defs.join("\n")}${syn}`
    })
    return fmt.lines(`📖 ${fmt.bold(e.word)}${e.phonetic ? `  ${e.phonetic}` : ""}`, "", meanings.join("\n\n"))
  },
})
