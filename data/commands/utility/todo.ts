import {defineCommand, fmt, newId, type TodoTask} from "../../../src/sdk"

const MAX_TASKS = 100

export default defineCommand({
  name: "todo",
  description: "Manage a personal or group task list",
  details: "Use add, list, claim, done and remove. Tasks are stored in this chat; creators and assignees control completion.",
  category: "Utility",
  args: [
    {name: "action", type: "string", description: "add, list, claim, done or remove"},
    {name: "value", type: "text", description: "Task id or text"},
  ],
  examples: ["todo add bring projector", "todo list", "todo claim abc123", "todo done abc123"],
  async run(ctx) {
    const action = (ctx.args.action ?? "list").toLowerCase()
    const value = ctx.args.value?.trim() ?? ""
    const data = ctx.isGroup ? ctx.groupData : ctx.contactData
    const settings = await data.get()
    const tasks = [...(settings.tasks ?? [])]
    const save = (next: TodoTask[]) => data.update((s) => {
      s.tasks = next
    })
    if (action === "list") {
      if (!tasks.length) return "✅ Nothing on the task list."
      const lines = tasks.map((t) => `${t.done ? "✅" : t.assigneeKey ? "🔒" : "⬜"} ${fmt.code(t.id)} ${t.text}${t.assigneeName ? ` — ${t.assigneeName}` : ""}`)
      await ctx.paginate({title: `📝 ${ctx.isGroup ? "Group" : "Personal"} tasks`, items: lines, perPage: 12})
      return
    }
    if (action === "add") {
      if (!value) return ctx.usageError("Write the task after /todo add.")
      if (tasks.length >= MAX_TASKS) return ctx.fail(`This task list is full (${MAX_TASKS} tasks). Complete or remove something first.`)
      const task: TodoTask = {id: newId(3), text: value.slice(0, 300), creatorKey: ctx.sender.key, creatorName: ctx.sender.displayName, createdAt: Date.now()}
      await save([...tasks, task])
      return `✅ Added ${fmt.code(task.id)}: ${task.text}`
    }
    if (!["claim", "done", "remove"].includes(action) || !value) return ctx.usageError("Use /todo add <text>, list, claim <id>, done <id> or remove <id>.")
    const task = tasks.find((t) => t.id === value.toLowerCase())
    if (!task) return ctx.fail(`No task called ${fmt.code(value)}.`)
    if (action === "claim") {
      if (task.done) return ctx.fail("That task is already complete.")
      task.assigneeKey = ctx.sender.key
      task.assigneeName = ctx.sender.displayName
      await save(tasks)
      return `🔒 ${ctx.sender.displayName} claimed ${fmt.code(task.id)}.`
    }
    if (action === "done") {
      if (task.creatorKey !== ctx.sender.key && task.assigneeKey !== ctx.sender.key) return ctx.fail("Only the task creator or assignee can complete it.")
      task.done = true
      await save(tasks)
      return `✅ Completed ${fmt.code(task.id)}: ${task.text}`
    }
    if (task.creatorKey !== ctx.sender.key) return ctx.fail("Only the task creator can remove it.")
    await save(tasks.filter((t) => t.id !== task.id))
    return `🗑 Removed ${fmt.code(task.id)}.`
  },
})
