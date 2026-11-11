# Custom commands

Put your own commands here. Everything in this folder except this README is gitignored, so your commands stay
in your copy of Rubi and never end up in the repository or in pull requests.

They work exactly like the built-in ones:

1. Copy `data/commands/_template.ts` to `data/commands/custom/<name>.ts`.
2. Change the import to `../../../src/sdk` (one folder deeper than the template).
3. Restart the bot (or send `/reload` as a bot admin). `/help` and the app menu list them under 🧩 Custom
   unless you set another `category`.

Subfolders work too. Names and aliases must not clash with built-in commands, or the bot refuses to load them.
Keep in mind that `npm run check` runs against your local commands as well.
