# Telegram Topic Mode

Telegram topic mode lets a single Telegram forum supergroup host multiple MaxCode sessions, with each session bound to one Telegram topic.

## Requirements

- The Telegram chat must be a forum-enabled supergroup.
- The bot must be a member of that supergroup.
- To let MaxCode create and rename topics, the bot must be an administrator with topic management permission.
- The MaxCode Telegram channel `chat_id` must point to the intended supergroup. Updates from any other chat are ignored.

## Enable Topic Mode

1. Open MaxCode settings and create or edit a Telegram chat channel.
2. Set the Telegram bot token and the forum supergroup `chat_id`.
3. Enable **Topic mode**.
4. Save the channel and make sure it is connected.

Existing Telegram channels keep the old behavior until topic mode is enabled.

## Usage

- In the General topic, send `/task <description>` to create a new Telegram topic and start a new MaxCode session there.
- In a manually created topic, send `/task <description>` to start and bind a new session to that topic.
- In a manually created topic, send `/resume <id>` to bind an existing session to that topic.
- In a bound topic, plain text is treated as a follow-up for that topic's session.
- In the General topic, plain text is ignored. Use `/task <description>` explicitly to avoid accidental bot triggers in group chat.
- `/sessions`, `/cancel`, `/approve`, `/deny`, `/folder`, and `/agent` keep their existing meanings. In topic mode, session-specific commands resolve the current session from the Telegram topic binding.
- `/folder` and `/agent` without arguments show Telegram inline buttons when Telegram supports them.

## Title Sync

When MaxCode updates a conversation title, MaxCode attempts to rename the bound Telegram topic. This is best-effort: if Telegram rejects the rename or the bot lacks permission, the MaxCode conversation still updates.

## Notes

- Topic mode is Telegram-only in this release. Lark/Feishu and Weixin behavior is unchanged.
- MaxCode does not automatically cancel a session when a Telegram topic is closed or deleted.
- Historical sessions are not automatically migrated into Telegram topics.
