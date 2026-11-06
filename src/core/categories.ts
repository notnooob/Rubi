/**
 * Known command categories: display order and icon in /help and the app command menu.
 * Commands in other categories still work — they get the default icon and are sorted after these.
 *
 * A command's category defaults to its subfolder in data/commands (e.g. data/commands/fun/dice.ts → "Fun"),
 * or "General" for files directly in data/commands.
 */
export const CATEGORIES: readonly {name: string; icon: string; description: string}[] = [
  {name: "General", icon: "📖", description: "Basics and bot info"},
  {name: "Utility", icon: "🛠", description: "Handy tools"},
  {name: "Web", icon: "🌐", description: "Look things up online"},
  {name: "Fun", icon: "🎲", description: "Games and fun stuff"},
  {name: "Groups", icon: "👥", description: "Group features"},
  {name: "Moderation", icon: "🛡", description: "Keep groups tidy (moderators/admins)"},
  {name: "Admin", icon: "⚙️", description: "Bot operator tools"},
]

export const DEFAULT_CATEGORY = "General"
const DEFAULT_ICON = "📁"

export function categoryIcon(name: string): string {
  return CATEGORIES.find((c) => c.name.toLowerCase() === name.toLowerCase())?.icon ?? DEFAULT_ICON
}

export function categoryRank(name: string): number {
  const i = CATEGORIES.findIndex((c) => c.name.toLowerCase() === name.toLowerCase())
  return i === -1 ? CATEGORIES.length : i
}

export function normalizeCategory(name: string): string {
  const known = CATEGORIES.find((c) => c.name.toLowerCase() === name.toLowerCase())
  if (known) return known.name
  return name ? name[0]!.toUpperCase() + name.slice(1) : DEFAULT_CATEGORY
}
