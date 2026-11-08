import {
  attachmentsBlocked,
  defineCommand,
  describeMedia,
  downloadAttachments,
  fetchComment,
  fetchPost,
  findRedditLink,
  fmt,
  MEDIA_HEADERS,
  parseRedditLink,
  pollText,
  postHeader,
  postMedia,
  postStats,
  redditToSimplex,
  removalNote,
  resolveShareLink,
  sendAttachments,
  truncateMarkdown,
  type RedditComment,
  type RedditMedia,
  type RedditPost,
} from "../../../src/sdk"

/** Most attachments sent for one post (Reddit galleries hold up to 20). */
const MAX_ATTACHMENTS = 20
const MAX_BODY = 3000
const MAX_COMMENT = 1200

export default defineCommand({
  name: "reddit",
  aliases: ["r"],
  description: "Show a Reddit post: /reddit <link>",
  details:
    "Shows the post's title, text, score and upvote ratio, and attaches its images, GIFs, videos and files. " +
    "Reply to a message containing a Reddit link with just /reddit or /r to show that post. " +
    "Append - to the link, or reply with /reddit -, to report its media without downloading or attaching it. " +
    "Works with post links, share links (reddit.com/r/…/s/…), redd.it links and post ids. " +
    "Posts come from the Arctic Shift archive, so brand-new posts can take a few minutes to appear, and scores " +
    "are refreshed about 36 hours after posting. Media of NSFW posts is only sent in DMs.",
  category: "Web",
  args: [{name: "link", type: "text", description: "Post link, share link or post id (or reply to a link)", required: false}],
  examples: ["reddit https://www.reddit.com/r/running/comments/17snc7d/", "r https://www.reddit.com/r/running/s/3TzXiyxaMD"],
  live: "🔎 Finding the post",
  cooldown: 10,
  timeout: 300,
  async run(ctx) {
    const quoted = ctx.item.chatItem.quotedItem?.content.text
    const parts = ctx.rawArgs.trim().split(/\s+/).filter(Boolean)
    const noMedia = parts.at(-1) === "-" || /-$/.test(parts[0] ?? "")
    if (parts.at(-1) === "-") parts.pop()
    if (parts.length > 1) return ctx.usageError("Give one Reddit link, optionally followed by `-` to skip attachments.")
    const input = noMedia ? (parts[0] ?? "").replace(/-$/, "") : parts[0] ?? ""
    const link = input ? parseRedditLink(input) : quoted ? findRedditLink(quoted) : undefined
    if (!link) {
      return ctx.usageError(input ? "That isn't a Reddit post link." : "Reply to a message containing a Reddit post link, or include the link after /reddit.")
    }

    let postId: string
    let commentId: string | undefined
    if ("share" in link) {
      ctx.progress("🔗 Unshortening the share link")
      ;({postId, commentId} = await resolveShareLink(ctx.http, link.share))
    } else {
      ;({postId, commentId} = link)
    }

    ctx.progress(`📥 Fetching post ${fmt.code(postId)}`)
    const post = await fetchPost(ctx.http, postId)
    if (!post) {
      return ctx.fail(`I couldn't find post ${fmt.code(postId)}. New posts can take a few minutes to reach the archive, so try again soon.`)
    }
    const comment = commentId ? await fetchComment(ctx.http, commentId).catch(() => undefined) : undefined

    const media = postMedia(post)
    const mediaSource = post.crosspost_parent_list?.[0]
    const sensitive = !!post.over_18 || !!mediaSource?.over_18
    const blocked = media.length ? (sensitive && ctx.isGroup && !ctx.isBusiness ? "🔞 Media from NSFW posts is only sent in DMs." : attachmentsBlocked(ctx)) : undefined
    const wanted = blocked || noMedia ? [] : media.slice(0, MAX_ATTACHMENTS)
    const body = renderPost(post, comment, media)
    // the post, then (at the bottom) its stats, what's attached, notes and the link
    const compose = (...status: (string | false | undefined)[]) =>
      fmt.lines(body, "", postStats(post), ...status, "", `🌐 ${permalink(post, commentId)}`)
    if (!wanted.length) return compose(noMedia && media.length ? `📎 ${describeMedia(media.map((m) => m.kind))} available · not downloaded` : blocked)

    // show the post right away while the media downloads
    const what = describeMedia(wanted.map((m) => m.kind))
    ctx.progress(compose(`📥 Downloading ${what}`))
    const dl = await downloadAttachments(ctx, wanted, {
      label: `reddit-${post.id}`,
      headers: MEDIA_HEADERS,
      service: "Reddit media",
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

function permalink(post: RedditPost, commentId?: string): string {
  return commentId ? `https://www.reddit.com${post.permalink.replace(/\/?$/, "/")}${commentId}/` : `https://redd.it/${post.id}`
}

function renderPost(post: RedditPost, comment: RedditComment | undefined, media: RedditMedia[]): string {
  const parent = post.crosspost_parent_list?.[0]
  const text = (post.selftext?.trim() || parent?.selftext?.trim() || "").replace(/^\[(removed|deleted)\]$/, "")
  const imageNo = new Map(media.map((m, i) => [m.mediaId, i + 1]))
  const md = redditToSimplex(text, {mediaLabel: (id) => (imageNo.has(id) ? `🖼 ${fmt.italic(`image ${imageNo.get(id)}`)}` : undefined)})
  const {text: shown, cut} = truncateMarkdown(md, MAX_BODY)
  const url = parent?.url_overridden_by_dest ?? post.url_overridden_by_dest ?? post.url
  // a link post's link, unless it only points at Reddit itself or at the media attached below
  const onReddit = /^https?:\/\/([a-z0-9-]+\.)*(reddit\.com|redd\.it)(\/|$)/i
  const external = !post.is_self && url && !onReddit.test(url) && !media.some((m) => m.url === url) ? url : undefined
  return fmt.lines(
    postHeader(post),
    removalNote(post),
    parent && `🔁 Crossposted from ${fmt.color("magenta", `r/${parent.subreddit}`)} · u/${parent.author ?? "[deleted]"}`,
    shown && `\n${shown}`,
    cut && fmt.italic("Continued on Reddit"),
    pollText(post) && `\n${pollText(post)}`,
    external && `\n🔗 ${external}`,
    comment && `\n${renderComment(comment)}`
  )
}

function renderComment(c: RedditComment): string {
  const body = truncateMarkdown(redditToSimplex(c.body ?? ""), MAX_COMMENT)
  const quoted = (body.text || "[deleted]")
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n")
  return fmt.lines(
    "──────────",
    `💬 ${fmt.bold(`u/${c.author ?? "[deleted]"}`)} · ⬆️ ${fmt.num(c.score ?? 0, 0)} · ${fmt.when(c.created_utc * 1000)}`,
    quoted,
    body.cut && fmt.italic("Continued on Reddit")
  )
}
