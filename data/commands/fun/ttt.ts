import {chatUtil, defineCommand, defineInteraction, fmt, makeUi, type Interaction} from "../../../src/sdk"

const MARK = {X: "❌", O: "⭕"} as const
const CELL = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"]
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]

type Side = keyof typeof MARK
interface Player {
  key: string
  name: string
}
interface TttState {
  X: Player
  O: Player
  board: (Side | "")[]
  turn: Side
  result?: Side | "draw" | "stopped"
  prefix: string
  tappable: boolean
}

export function winner(board: TttState["board"]): Side | "draw" | undefined {
  for (const [a, b, c] of LINES) if (board[a!] && board[a!] === board[b!] && board[a!] === board[c!]) return board[a!] as Side
  return board.every(Boolean) ? "draw" : undefined
}

function render(ix: Interaction<TttState>): string {
  const s = ix.state
  const ui = makeUi(s.tappable, s.prefix)
  const grid = [0, 3, 6].map((r) => s.board.slice(r, r + 3).map((v, i) => (v ? MARK[v] : CELL[r + i])).join("")).join("\n")
  const status =
    s.result === "draw" ? "🤝 Draw!" : s.result === "stopped" ? fmt.italic("Stopped.") : s.result ? `🏆 ${fmt.bold(s[s.result].name)} wins!` : `${MARK[s.turn]} ${fmt.bold(s[s.turn].name)}'s turn · ${ui.cmd("ttt", "<1-9>")}`
  const free = s.board.flatMap((v, i) => (v ? [] : [i + 1]))
  return fmt.lines(
    `${MARK.X} ${fmt.bold(s.X.name)} vs ${MARK.O} ${fmt.bold(s.O.name)}`,
    "",
    grid,
    "",
    status,
    !s.result ? ui.buttons(free.map((n) => ui.button("", "ttt", String(n))), " ") : undefined,
    !s.result ? ui.button("✖ Stop", "ttt", "stop", {important: true}) : undefined
  )
}

defineInteraction<TttState>("ttt", {})

export default defineCommand({
  name: "ttt",
  aliases: ["tictactoe"],
  description: "Tic-tac-toe vs a member",
  details: "Challenge someone with /ttt @member; you play ❌ and go first. Move with /ttt <1-9>. Either player can stop with /ttt stop. Games expire after a day.",
  category: "Fun",
  scope: "group",
  args: [{name: "input", type: "text", description: "@member, a cell 1-9, or stop"}],
  examples: ["ttt @bob", "ttt 5", "ttt stop"],
  cooldown: 0,
  async run(ctx) {
    const input = ctx.args.input?.trim() ?? ""
    const key = chatUtil.chatKey(ctx.ref)
    const gameOf = (player: string) =>
      ctx.rt.interactions.find<TttState>((ix) => ix.kind === "ttt" && chatUtil.chatKey(ix.ref) === key && (ix.state.X.key === player || ix.state.O.key === player))
    const mine = gameOf(ctx.sender.key)

    if (/^\d$/.test(input) || /^stop$/i.test(input)) {
      if (!mine) return ctx.fail(`You're not in a game here. Challenge someone: ${ctx.ui.cmd("ttt", "@member")}`)
      const reply = await ctx.rt.interactions.mutate<TttState, string>(mine.id, async (ix) => {
        const s = ix.state
        if (/^stop$/i.test(input)) s.result = "stopped"
        else {
          const side: Side = s.X.key === ctx.sender.key ? "X" : "O"
          if (s.turn !== side) return `It's ${s[s.turn].name}'s turn.`
          const i = Number(input) - 1
          if (i < 0 || s.board[i]) return "Pick a free cell from 1 to 9."
          s.board[i] = side
          s.turn = side === "X" ? "O" : "X"
          s.result = winner(s.board)
        }
        await ctx.rt.messenger.update(ix.ref, ix.itemId, render(ix))
        if (s.result) ctx.rt.interactions.end(ix.id)
        else ctx.rt.interactions.save(ix)
        if (s.result === "draw") return "🤝 It's a draw!"
        if (s.result === "stopped") return "✅ Game stopped."
        if (s.result) return `🏆 ${fmt.bold(s[s.result].name)} wins!`
        await ctx.react("✅")
        return ""
      })
      if (reply === undefined) return ctx.fail("That game has just ended.")
      return reply || undefined
    }

    if (!input) return ctx.usageError("Challenge someone with /ttt @member.")
    const opponent = await ctx.resolveMember(input)
    const opponentKey = `g${ctx.group!.groupId}:m${opponent.groupMemberId}`
    if (opponentKey === ctx.sender.key) return ctx.fail("You can't play against yourself.")
    if (opponent.groupMemberId === ctx.group!.membership.groupMemberId) return ctx.fail("I'd rather watch. Challenge another member.")
    if (mine) return ctx.fail(`Finish or stop your current game first (${ctx.ui.cmd("ttt", "stop")}).`)
    if (gameOf(opponentKey)) return ctx.fail(`${opponent.memberProfile.displayName} is already playing.`)
    const state: TttState = {
      X: {key: ctx.sender.key, name: ctx.sender.displayName},
      O: {key: opponentKey, name: opponent.memberProfile.displayName},
      board: Array(9).fill(""),
      turn: "X",
      prefix: ctx.config.prefix,
      tappable: ctx.ui.tappable,
    }
    const msg = await ctx.reply(`${ctx.mention(opponent)}, ${ctx.sender.displayName} challenges you to tic-tac-toe!`)
    const ix = ctx.rt.interactions.create("ttt", msg, state, {ownerKey: ctx.sender.key, ttlMs: 86_400_000})
    await msg.edit(render(ix))
  },
})
