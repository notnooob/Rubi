import {chatUtil, defineCommand, defineJob, describeError, fmt, loadFeed, modLog, PermissionError, plainText, type FeedItem, type Runtime, type T} from "../../../src/sdk"

const CHECK_EVERY_MS = 30 * 60_000
const MAX_FEEDS = 10
/** At most this many new entries per check, so a feed that changes its ids can't flood the group. */
const MAX_POSTS = 5
const MAX_SEEN = 500

/** A subscription is just a recurring job: its payload holds the state, and forgetChat drops it with the chat. */
export interface FeedJob {
  ref: T.ChatRef
  url: string
  title: string
  /** Entry ids already posted (or present when subscribing). */
  seen: string[]
  by: string
  failures?: number
  error?: string
}

function renderItems(title: string, items: FeedItem[]): string {
  return fmt.lines(
    `📰 ${fmt.bold(plainText(fmt.truncate(title, 100)))}`,
    ...items.map((i) => fmt.lines(`• ${plainText(fmt.truncate(i.title, 200))}`, i.link ? `  ${i.link}` : undefined))
  )
}

defineJob<FeedJob>("feed", async (job, rt: Runtime) => {
  const p = job.payload
  try {
    const {feed} = await loadFeed(rt.http, p.url)
    const seen = new Set(p.seen)
    const fresh = feed.items.filter((i) => !seen.has(i.id)).slice(0, MAX_POSTS).reverse()
    if (fresh.length) await rt.messenger.send(p.ref, renderItems(feed.title || p.title, fresh))
    const current = new Set(feed.items.map((i) => i.id))
    p.seen = [...current, ...p.seen.filter((id) => !current.has(id))].slice(0, MAX_SEEN)
    p.title = feed.title || p.title
    p.failures = 0
    delete p.error
  } catch (e) {
    // keep checking: a feed being down for a while shouldn't end the subscription
    p.failures = (p.failures ?? 0) + 1
    p.error = describeError(e)
    rt.log.warn(`feed ${p.url}: ${p.error}`)
  }
  return Date.now() + CHECK_EVERY_MS
})

export default defineCommand({
  name: "feed",
  aliases: ["rss"],
  description: "RSS/Atom feeds for this group",
  details:
    `/feed lists this group's feeds; admins use /feed add <url> and /feed remove <id>. Checked every ${CHECK_EVERY_MS / 60_000} minutes, up to ${MAX_FEEDS} feeds per group. ` +
    "Works with blogs and news sites (a page that links its feed is enough), GitHub (github.com/<owner>/<repo>/releases.atom), " +
    "subreddits (reddit.com/r/<name>/.rss), YouTube channel pages and Mastodon profiles.",
  category: "Groups",
  scope: "group",
  args: [
    {name: "action", type: "string", description: "list, add or remove", choices: ["list", "add", "remove"]},
    {name: "target", type: "string", description: "Feed URL (add) or id (remove)"},
  ],
  examples: ["feed", "feed add https://github.com/simplex-chat/simplex-chat/releases.atom", "feed remove ab12cd"],
  async run(ctx) {
    const {action = "list", target} = ctx.args
    const key = chatUtil.chatKey(ctx.ref)
    const feeds = ctx.rt.scheduler.list<FeedJob>((j) => j.kind === "feed" && chatUtil.chatKey(j.payload.ref) === key)

    if (action === "list") {
      if (!feeds.length) return `📰 No feeds here yet.${ctx.can("admin") ? ` Add one: ${ctx.ui.cmd("feed", "add <url>")}` : ""}`
      return fmt.lines(
        `📰 ${fmt.bold("Feeds")} · checked every ${CHECK_EVERY_MS / 60_000} min`,
        ...feeds.map((j) =>
          fmt.lines(
            `${fmt.code(j.id)} ${fmt.bold(plainText(j.payload.title))}`,
            `  ${j.payload.url}`,
            j.payload.error ? `  ⚠️ ${fmt.italic(`${j.payload.failures} failed checks: ${j.payload.error}`)}` : undefined
          )
        )
      )
    }
    if (!ctx.can("admin")) throw new PermissionError("Only group admins can add or remove feeds.")

    if (action === "remove") {
      const job = feeds.find((j) => j.id === target?.toLowerCase())
      if (!job) return ctx.usageError(`No feed with that id here. See ${ctx.ui.cmd("feed")}.`)
      ctx.rt.scheduler.cancel(job.id)
      void modLog(ctx.rt, ctx.group!, `${ctx.sender.displayName} removed the feed ${job.payload.url}`)
      return `🗑 Removed ${fmt.bold(plainText(job.payload.title))}.`
    }

    if (!target) return ctx.usageError("Give the feed's URL.")
    let url: string
    try {
      url = new URL(/^https?:\/\//i.test(target) ? target : `https://${target}`).href
    } catch {
      return ctx.usageError(`"${target}" isn't a URL.`)
    }
    if (feeds.length >= MAX_FEEDS) return ctx.fail(`This group already has ${MAX_FEEDS} feeds. Remove one first.`)
    await ctx.defer("📰 Checking the feed")
    const loaded = await loadFeed(ctx.http, url)
    if (feeds.some((j) => j.payload.url === loaded.url)) return ctx.fail("This group already follows that feed.")
    const title = loaded.feed.title || new URL(loaded.url).hostname
    const job = ctx.rt.scheduler.schedule<FeedJob>("feed", Date.now() + CHECK_EVERY_MS, {
      ref: ctx.ref,
      url: loaded.url,
      title,
      seen: loaded.feed.items.map((i) => i.id).slice(0, MAX_SEEN),
      by: ctx.sender.displayName,
    })
    void modLog(ctx.rt, ctx.group!, `${ctx.sender.displayName} added the feed ${loaded.url}`)
    const latest = loaded.feed.items[0]
    return fmt.lines(
      `📰 Following ${fmt.bold(plainText(title))} (id ${fmt.code(job.id)}). New entries will be posted here.`,
      latest ? fmt.italic(`Latest: ${plainText(fmt.truncate(latest.title, 150))}`) : undefined,
      latest?.link
    )
  },
})
