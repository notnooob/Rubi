# SimpleX Chat bot docs (mirrored)

Synced from `simplex-chat/simplex-chat` @ `stable` on 2026-11-06T00:31:49.069Z.
Re-sync with `npm run docs:sync`. Do not hand-edit files in this folder — they are overwritten.

## Start here

- [PACKAGE_README.md](PACKAGE_README.md) — `simplex-chat` npm package guide (install, quick start, Postgres)
- [README.md](README.md) — TypeDoc root for the npm package
- [bot-api/BOTS_README.md](bot-api/BOTS_README.md) — how SimpleX bots work (chat core concepts)

## Chat core bot API (what the npm package wraps)

- [bot-api/COMMANDS.md](bot-api/COMMANDS.md) — every chat command, its params and responses
- [bot-api/EVENTS.md](bot-api/EVENTS.md) — every event emitted by chat core
- [bot-api/TYPES.md](bot-api/TYPES.md) — every type (ChatItem, GroupMember, MsgContent, ...)
- [bot-api/README.md](bot-api/README.md)

## npm package namespaces

- [Namespace.api.md](Namespace.api.md)
- [Namespace.bot.md](Namespace.bot.md)
- [Namespace.core.md](Namespace.core.md)
- [Namespace.util.md](Namespace.util.md)

### api

- [api.Class.ChatApi.md](api.Class.ChatApi.md)
- [api.Class.ChatCommandError.md](api.Class.ChatCommandError.md)
- [api.Enumeration.ConnReqType.md](api.Enumeration.ConnReqType.md)
- [api.Interface.BotAddressSettings.md](api.Interface.BotAddressSettings.md)
- [api.TypeAlias.DbConfig.md](api.TypeAlias.DbConfig.md)
- [api.TypeAlias.EventSubscriberFunc.md](api.TypeAlias.EventSubscriberFunc.md)
- [api.TypeAlias.EventSubscribers.md](api.TypeAlias.EventSubscribers.md)
- [api.Variable.defaultBotAddressSettings.md](api.Variable.defaultBotAddressSettings.md)

### bot

- [bot.Function.run.md](bot.Function.run.md)
- [bot.Interface.BotConfig.md](bot.Interface.BotConfig.md)
- [bot.Interface.BotOptions.md](bot.Interface.BotOptions.md)
- [bot.TypeAlias.BotDbOpts.md](bot.TypeAlias.BotDbOpts.md)

### core

- [core.Class.ChatAPIError.md](core.Class.ChatAPIError.md)
- [core.Class.ChatInitError.md](core.Class.ChatInitError.md)
- [core.DBMigrationError.Interface.ErrorMigration.md](core.DBMigrationError.Interface.ErrorMigration.md)
- [core.DBMigrationError.Interface.ErrorNotADatabase.md](core.DBMigrationError.Interface.ErrorNotADatabase.md)
- [core.DBMigrationError.Interface.ErrorSQL.md](core.DBMigrationError.Interface.ErrorSQL.md)
- [core.DBMigrationError.Interface.InvalidConfirmation.md](core.DBMigrationError.Interface.InvalidConfirmation.md)
- [core.DBMigrationError.TypeAlias.Tag.md](core.DBMigrationError.TypeAlias.Tag.md)
- [core.Enumeration.MigrationConfirmation.md](core.Enumeration.MigrationConfirmation.md)
- [core.Function.chatCloseStore.md](core.Function.chatCloseStore.md)
- [core.Function.chatDecryptFile.md](core.Function.chatDecryptFile.md)
- [core.Function.chatEncryptFile.md](core.Function.chatEncryptFile.md)
- [core.Function.chatMigrateInit.md](core.Function.chatMigrateInit.md)
- [core.Function.chatReadFile.md](core.Function.chatReadFile.md)
- [core.Function.chatRecvMsgWait.md](core.Function.chatRecvMsgWait.md)
- [core.Function.chatSendCmd.md](core.Function.chatSendCmd.md)
- [core.Function.chatWriteFile.md](core.Function.chatWriteFile.md)
- [core.Interface.APIResult.md](core.Interface.APIResult.md)
- [core.Interface.CryptoArgs.md](core.Interface.CryptoArgs.md)
- [core.Interface.UpMigration.md](core.Interface.UpMigration.md)
- [core.MTRError.Interface.MTREDifferent.md](core.MTRError.Interface.MTREDifferent.md)
- [core.MTRError.Interface.MTRENoDown.md](core.MTRError.Interface.MTRENoDown.md)
- [core.MTRError.TypeAlias.Tag.md](core.MTRError.TypeAlias.Tag.md)
- [core.MigrationError.Interface.MEDowngrade.md](core.MigrationError.Interface.MEDowngrade.md)
- [core.MigrationError.Interface.MEUpgrade.md](core.MigrationError.Interface.MEUpgrade.md)
- [core.MigrationError.Interface.MigrationError.md](core.MigrationError.Interface.MigrationError.md)
- [core.MigrationError.TypeAlias.Tag.md](core.MigrationError.TypeAlias.Tag.md)
- [core.Namespace.DBMigrationError.md](core.Namespace.DBMigrationError.md)
- [core.Namespace.MTRError.md](core.Namespace.MTRError.md)
- [core.Namespace.MigrationError.md](core.Namespace.MigrationError.md)
- [core.TypeAlias.DBMigrationError.md](core.TypeAlias.DBMigrationError.md)
- [core.TypeAlias.MTRError.md](core.TypeAlias.MTRError.md)
- [core.TypeAlias.MigrationError.md](core.TypeAlias.MigrationError.md)

### util

- [util.Function.botAddressSettings.md](util.Function.botAddressSettings.md)
- [util.Function.chatInfoName.md](util.Function.chatInfoName.md)
- [util.Function.chatInfoRef.md](util.Function.chatInfoRef.md)
- [util.Function.ciBotCommand.md](util.Function.ciBotCommand.md)
- [util.Function.ciContentText.md](util.Function.ciContentText.md)
- [util.Function.contactAddressStr.md](util.Function.contactAddressStr.md)
- [util.Function.fromLocalProfile.md](util.Function.fromLocalProfile.md)
- [util.Function.reactionText.md](util.Function.reactionText.md)
- [util.Function.senderName.md](util.Function.senderName.md)
- [util.Interface.BotCommand.md](util.Interface.BotCommand.md)
