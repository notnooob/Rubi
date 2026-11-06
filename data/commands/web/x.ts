import {
  attachmentsBlocked,
  defineCommand,
  describeMedia,
  downloadAttachments,
  fetchXPost,
  fmt,
  parseXLink,
  renderXPost,
  sendAttachments,
  X_MEDIA_HEADERS,
  xMedia,
  xStats,
} from "../../../src/sdk"

const MAX_ATTACHMENTS = 10

export default defineCommand({
  name: "x",
  aliases: ["twitter", "tweet"],
  description: "Show a post from X (Twitter): /x <link>",
  details:
    "Shows the post's author, text, replies/reposts/likes/views, polls, community notes and quoted posts, and attaches " +
    "its photos, videos and GIFs (including the quoted post's). Posts are fetched through the FxTwitter API. " +
    "Media of sensitive posts is only sent in DMs.",
  category: "Web",
  args: [{name: "link", type: "text", description: "x.com or twitter.com post link", required: true}],
  examples: ["x https://x.com/jack/status/20"],
  live: "🔎 Fetching the post",
  cooldown: 5,
  timeout: 300,
  async run(ctx) {
    const link = parseXLink(ctx.args.link.split(/\s+/)[0]!)
    if (!link) return ctx.usageError("That isn't a link to a post on X.")

    const post = await fetchXPost(ctx.http, link)
    if (!post) return ctx.fail("That post doesn't exist, or it was deleted.")

    // a reply: also show the post it answers (best effort)
    const parent = post.replying_to_status
      ? await fetchXPost(ctx.http, {user: post.replying_to ?? undefined, id: post.replying_to_status}).catch(() => undefined)
      : undefined

    const media = xMedia(post)
    const sensitive = post.possibly_sensitive || (post.quote && "possibly_sensitive" in post.quote && post.quote.possibly_sensitive)
    const blocked = media.length ? (sensitive && ctx.isGroup && !ctx.isBusiness ? "🔞 Media from sensitive posts is only sent in DMs." : attachmentsBlocked(ctx)) : undefined
    const wanted = blocked ? [] : media.slice(0, MAX_ATTACHMENTS)
    const body = renderXPost(post, {parent})
    // the post, then (at the bottom) its stats, what's attached, notes and the link
    const compose = (...status: (string | false | undefined)[]) => fmt.lines(body, "", xStats(post), ...status, "", `🌐 ${post.url}`)
    if (!wanted.length) return compose(blocked)

    const what = describeMedia(wanted.map((m) => m.kind))
    ctx.progress(compose(`📥 Downloading ${what}`))
    const dl = await downloadAttachments(ctx, wanted, {
      label: `x-${post.id}`,
      headers: X_MEDIA_HEADERS,
      service: "X media",
      onProgress: (done, total) => total > 1 && ctx.progress(compose(`📥 Downloading ${what}: ${done}/${total}`)),
    })
    const extra = [...dl.notes, media.length > wanted.length && `ℹ️ Showing the first ${wanted.length} of ${media.length}.`]
    if (!dl.messages.length) return compose(...extra)

    const msg = await ctx.reply(compose(`📎 ${describeMedia(dl.messages.map((m) => m.msgContent.type))} below`, ...extra))
    if (!(await sendAttachments(ctx, dl, msg.itemId))) {
      await msg.edit(compose("⚠️ I couldn't attach the media here. Files may be turned off in this chat.")).catch(() => undefined)
    }
  },
})
