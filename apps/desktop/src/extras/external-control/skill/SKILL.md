---
name: deepwrite
description: Operate the user's DeepWrite writing app through its MCP tools. Use when the user wants to read, write, organize or generate work in DeepWrite, including short stories, scripts, long-form novels, academic works, murder mysteries (剧本杀), material libraries, skill libraries and agent teams.
---

# DeepWrite

DeepWrite is a desktop writing app. These tools operate the user's running copy. Changes take effect immediately and appear in the user's window, so there is no review step between you and their work.

## Start here

1. Call `get_app_status`. It opens DeepWrite if it is closed.
2. Find the target with `list_works` or `list_libraries`, then `get_work` or `get_library` for its documents.
3. Read before you write.
4. Call `restart_app` if DeepWrite needs to restart; the bridge waits for the new instance and reconnects automatically. Use `force: true` only when an active run blocks restart or the app is unresponsive (never during an update).

## Tools

- Read: `list_works`, `get_work`, `read_document` (one page at a time; continue with `nextOffset` until it is null), `list_libraries`, `get_library`, `read_entry`, `search_text` (one work or library), `list_agent_teams` (pass `teamId` for full settings), `list_trash`.
- Write: `write_document`, `write_entry`, `manage_work`, `manage_document`, `manage_library`, `manage_entry`, `manage_agent_team`, `save_agent_team` (replaces a whole team; pass its `revision` as `baseRevision`), `restore_trash_item`.
- App and agent: `get_app_status`, `open_in_app`, `run_agent`, `get_agent_run`, `answer_agent_question`, `stop_agent_run`, `restart_app`.

## Choose how to do the work

- **Do it yourself** with `write_document`, `write_entry` and the `manage_*` tools when the change is specific and you already know the text.
- **Hand it to DeepWrite's agent** with `run_agent` for creative or academic drafting that should use the user's models, agent team and project context. Adding, moving or deleting long-form chapters or murder-mystery stages/roles/acts/clue rounds can only be done this way (or in the workspace), because `manage_document` covers short, script and academic works only.

## Academic works (`type: "academic"`)

- `list_works` and `get_work` return `type: "academic"` with `subtype` (`empirical_paper`, `humanities_paper`, `literature_review`, `thesis_dissertation`, `proposal_grant`, `tech_report_article`) and `citationStyle` (`gbt7714`, `apa`, `ieee`, `latex`, `none`), plus per-work `stages` (`frameworkStages`), optional `chapters`, `linkedMaterialLibraryIds` and `linkedSkillLibraryIds`.
- `manage_work` (`action: "create"`, `type: "academic"`) creates an academic work with optional `subtype` (default `"empirical_paper"`) and `citationStyle` (default `"gbt7714"`).
- Documents in `get_work.documents` are ordered in three layers:
  1. **Foundation (`group: "foundation"` and `"reference_card"`)**: fixed `thesis_overview` (`研究立意与核心贡献`), fixed `terminology` (`术语与符号表`), and verified literature/evidence cards (`academic-card:<cardId>`).
  2. **Argument framework (`group: "framework"`)**: per-book `frameworkStages` documents (independent per academic work; never shared globally).
  3. **Manuscript (`group: "manuscript"`)**: each section exposes three documents — `写作指引` (`academic-section:<id>:brief`), `正文` (`academic-section:<id>:body`) and `节末状态` (`academic-section:<id>:state`). Only `正文` (`body`) is exported to readers; `写作指引` holds the section takeaway/citation plan and `节末状态` records newly introduced notation, citations and cross-section promises.
- Do not fabricate unverified bibliographic entries, DOIs or experimental figures in academic works; use explicit `[待补引用: ...]` / `[待补数据: ...]` placeholders when verified cards or linked materials are missing.
- `manage_document` supports `create` (with optional `chapterId` or `documentId` for placement), `rename`, `move`, `duplicate` and recoverable `delete` of academic manuscript sections, preserving all three section documents (`brief`, `body`, `state`) and `chapterId` across `restore_trash_item`.

## Murder-mystery works (`type: "mystery"`)

- Murder-mystery (`mystery`) works organize documents across 5 stages (`truth`, `characters`, `scripts`, `clues`, `dm`); always get exact `documentId` keys from `get_work` (such as `truth_doc:core_truth`, `role:role_1:profile`, `player_act:role_1:act_1:body`, `clue_round:round_1`, `dm_manual`, `agents_md`).

## Writing rules

- `write_document` and `write_entry` replace the whole text. Pass the `revision` from your latest read as `baseRevision`.
- `external.stale_revision` means the text changed after you read it, usually because the user edited it. Read it again and redo your edit on the new text. Never retry the same content.
- `external.busy` means this target/shared resource is in use, the short setup queue is full, or the long editor has unsaved text. Unrelated works can still be created and edited while another work generates. Retry only the affected step; read again before writing. Global team changes/restoration remain protected while runs are active.
- Keep the user's existing text unless they asked you to change it. Replacing a document cannot be undone; only deletions can be restored.
- In short stories and screenplays, the State document stores character, plot, emotional or other continuity notes. Read or edit it using the document id returned by the work directory.
- A standalone `![description](images/filename.png)` or `.jpg` line references an illustration relative to the work's root folder. Preserve existing image references when editing; these tools cannot insert or upload images.

## Deleting

Deleted sections, entries and agent teams stay in the trash for 30 days. Deleted works and libraries only leave the list, and their folders stay on disk. Use `list_trash` and `restore_trash_item` to bring them back. Restored sections, entries and teams get new ids.

## Running DeepWrite's agent

1. `run_agent` returns a `runId` at once, and the window switches to that target. Tell the user if that may interrupt them. It uses the work's agent team when one is available; pass `mode: "normal"` for the main agent alone, or `mode: "team"` to fail instead of running without a team. `get_agent_run` reports the `mode` used.
2. New tasks use `newConversation: true`. Save the returned `runId`, `sessionId` and target id. Different targets run concurrently; the short FIFO queue covers only setup/send acceptance, not generation. A target already running remains protected. Start other authorized work before waiting; poll each owned run independently at the requested interval (this project uses 10 minutes).
3. For multi-step work, wait for that target's current round to finish, then call `run_agent` with the same target and returned `sessionId`, without `newConversation`. Do not switch a running target to another session.
4. After restart, query the original `runId` before sending again. Recovery may open its target/session. `interrupted` means no runtime is active: check saved documents and `lastCompletedTool`, then continue only unfinished steps with the returned `sessionId`. Never automatically replay the whole request. `recovery.available: false` means this run's recovery locator could not be persisted.
5. `toolUsage` comes from actual trace records, including child calls, deduplicated by call id: total, succeeded, failed, pending and per-tool totals. `durationMs` sums completed tool durations (parallel calls overlap); it is not wall time. Empty search results are successful calls. These counts do not certify task completion or manuscript quality; repeated calls are not guessed to be retries.
6. `waiting_for_input`: read `questions`. Answer with `answer_agent_question` if the answer is clear from what the user told you, otherwise ask the user.
7. `waiting_for_user`: the user has to act in DeepWrite. Tell them and keep polling. Automatic edits still saving after the reply keep the run `running`.
8. `failed` with an `error` naming documents means those edits were not saved, for example because the document changed on disk. `changes` leaves them out. Read those documents again before redoing the step.

The agent's edits save automatically. One exception: the plot structure is shared by every short story and screenplay, so a run that wants to add or change it stops at `waiting_for_input` with a confirmation question. Allow it only if the user asked you to change the plot structure; otherwise ask the user.

## When the tools fail

- `external.disabled`: the user has to allow external agents in DeepWrite under Settings → External agents.
- `external.approval_pending`: the user has to answer the connection dialog in DeepWrite, then retry.
- `external.unauthorized`: the user refused the connection. Do not retry until they say so.
- `external.app_unavailable`: the user has to open DeepWrite. While DeepWrite installs an update the message says so and the MCP connection then closes; do not retry until the user has reopened DeepWrite.
- `external.incompatible`: the MCP bridge and DeepWrite are different versions. The user has to copy the connection settings again from Settings → External agents.
- `external.not_ready`: DeepWrite is starting up or did not answer in time. Retry shortly.
- `external.not_found`: the id does not exist (anymore). List again for current ids.
- `external.invalid_input`: the arguments were rejected; the message says which one. Fix it instead of resending.
- `external.busy`: wait until the named target is available before retrying.
- `external.stale_revision`: read the latest content and reapply your changes against its revision.

Every error message states the next step. Follow it instead of guessing.

For long works, `get_work.continuity` reports `current`, `needs_review` or `unverified` for each batch. A saved ledger alone does not prove it matches current prose. Legacy records without body evidence are unverified. The built-in agent can review an existing batch through `propose_continuity_commit(review_commit_id, summary, foreshadowing_touchpoint_decisions: [])` after reading its bodies and checkpoint continuity files; acceptance refreshes evidence without adding another ledger. This status never blocks drafting.

Long-agent compatibility: `list(scope_id="book_line", view="continuity")` returns the book overview and concrete next calls. On chapter reads, an identical redundant `chapter_id` is removed; conflicting ids still fail. A standalone `max_chars` means `range="head"` and never grants a full-read editing credential. Results begin with `【参数归一化】` when corrected. `toolUsage.directSucceeded` and `normalizedSucceeded` partition successful trace calls; normalization does not hide failed calls.
