---
name: deepwrite
description: Operate the user's DeepWrite writing app through its MCP tools. Use when the user wants to read, write, organize or generate work in DeepWrite, including short stories, scripts, long-form novels, material libraries, skill libraries and agent teams.
---

# DeepWrite

DeepWrite is a desktop writing app. These tools operate the user's running copy. Changes take effect immediately and appear in the user's window, so there is no review step between you and their work.

## Start here

1. Call `get_app_status`. It opens DeepWrite if it is closed.
2. Find the target with `list_works` or `list_libraries`, then `get_work` or `get_library` for its documents.
3. Read before you write.

## Choose how to do the work

- **Do it yourself** with `write_document`, `write_entry` and the `manage_*` tools when the change is specific and you already know the text.
- **Hand it to DeepWrite's agent** with `run_agent` for creative work that should use the user's models, agent team and project context, such as drafting a chapter. Adding, moving or deleting long-form chapters can only be done this way, because `manage_document` covers short and script works only.

## Writing rules

- `write_document` and `write_entry` replace the whole text. Pass the `revision` from your latest read as `baseRevision`.
- `external.stale_revision` means the text changed after you read it, usually because the user edited it. Read it again and redo your edit on the new text. Never retry the same content.
- `external.busy` means this target/shared resource is in use, the short setup queue is full, or the long editor has unsaved text. Unrelated works can still be created and edited while another work generates. Retry only the affected step; read again before writing. Global team changes/restoration remain protected while runs are active.
- Keep the user's existing text unless they asked you to change it. Replacing a document cannot be undone; only deletions can be restored.

## Deleting

Deleted sections, entries and agent teams stay in the trash for 30 days. Deleted works and libraries only leave the list, and their folders stay on disk. Use `list_trash` and `restore_trash_item` to bring them back. Restored sections, entries and teams get new ids.

## Running DeepWrite's agent

1. `run_agent` returns a `runId` at once, and the window switches to that target. Tell the user if that may interrupt them. It uses the work's agent team when one is available; pass `mode: "normal"` for the main agent alone, or `mode: "team"` to fail instead of running without a team. `get_agent_run` reports the `mode` used.
2. New tasks use `newConversation: true`. Save the returned `runId`, `sessionId` and target id. Different targets run concurrently; the short FIFO queue covers only setup/send acceptance, not generation. A target already running remains protected. Start other authorized work before waiting; poll each owned run independently at the requested interval (this project uses 10 minutes).
3. For multi-step work, wait for that target's current round to finish, then call `run_agent` with the same target and returned `sessionId`, without `newConversation`. Do not switch a running target to another session.
4. `waiting_for_input`: read `questions`. Answer with `answer_agent_question` if the answer is clear from what the user told you, otherwise ask the user.
5. `waiting_for_user`: the user has to act in DeepWrite. Tell them and keep polling.

The agent's edits save automatically. `external.cross_stage_disabled` means the user must turn on the cross-stage auto-approval setting in DeepWrite's general settings. Do not work around it.

## When the tools fail

- `external.disabled`: the user has to allow external agents in DeepWrite under Settings → External agents.
- `external.approval_pending`: the user has to answer the connection dialog in DeepWrite, then retry.
- `external.unauthorized`: the user refused the connection. Do not retry until they say so.
- `external.app_unavailable`: the user has to open DeepWrite.

Every error message states the next step. Follow it instead of guessing.
