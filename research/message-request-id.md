# How a session message maps to its transcript row's requestId

Research for [#10](https://github.com/JezzyDeves/claude-plugins/issues/10), part of the session-topics map [#9](https://github.com/JezzyDeves/claude-plugins/issues/9).
Claude Code build **2.1.302**. Sources: the build's `plugin-authoring` skill, meaning `types/claude-code.d.ts` (cited as `d.ts:<line>`) and `reference.md`, plus a probe Mod run in a real interactive terminal session (`research/message-request-id-probe/`, see [Probe](#probe)).

## Answer

**The `requestId` a `ui.render` hook sees on a `UserMessage` or `AssistantMessage` row is that transcript row's `uuid`.** That is the same `uuid` that `session.append` hands a hook and that the session's transcript JSONL stores on the row's line. `$.ui.scroll({ to: { requestId: uuid } })` accepts it.

- **Prompt.** The `UserMessage` requestId is the `uuid` of the `session.append` row with `door: "prompt"` (observed).
- **Closing reply.** Each block of an assistant reply is its own stored row with its own `uuid`: a thinking block, a tool_use block and a text block are three rows. The `AssistantMessage` requestId is the `uuid` of the row that holds that text block (observed). So a turn's closing reply is the **last `door: "response"` row with non-empty text before the next prompt**, and its `uuid` is the jump target.
- **`SessionMessage` has no id** (`d.ts:11622-11648`; `handle` is only stamped for `session.compact` hooks). A Mod gets ids from one of the three sources below, not from `$.session.messages()`.

### Where a Mod gets the ids

| Source | What it gives | Covers | Limits |
|---|---|---|---|
| `on("session.append")`, main conversation only (`e.agentId === undefined`) | `uuid`, `door`, `origin`, `message.{type, role, isMeta, content}` for every row as it is stored (`d.ts:10994-11022`) | every row added while the Mod is loaded | **Not raised for loaded rows** ("a `--resume`, a teleport … loads are not appends", reference.md, *session.append*). Not replayed after a Mod reload. |
| `on("ui.render", { component: "UserMessage" \| "AssistantMessage" })` | `e.requestId` (= uuid), `e.props.text`, `origin.kind`, `isFirstOfReply`, `onScreen` (`d.ts:10131-10305`) | every row the transcript draws, including the rows drawn again after a Mod reload (observed) | Only rows that are drawn. A prompt row first renders as `requestId: "placeholder"` (the optimistic row before it is stored), so ignore that id. A slash command's echo row also renders as `placeholder`. |
| The transcript file, `$.fs.read(transcript_path)` (`transcript_path` comes from a `classic.*` hook's envelope, `d.ts:853-855`; the file is named after `$.session.id()`, `d.ts:2850`) | every stored row with its `uuid`, `type`, `isMeta`, `promptId`, `message` | full history, resumed rows included | `$.fs.read` rejects files over **4 MiB** and has no range reads (`d.ts:3302-3325`, `5108-5123`). **Pitfall:** assistant lines also carry a field named `requestId`, which is the *API* request id. The render id is the line's `uuid`. |

**What fits session-topics:** index turns live from `session.append`: a prompt is `door: "prompt"` with `origin.kind` `composer` and not `isMeta`, and the closing reply is the last text-bearing `response` row before the next prompt. Persist `{ promptUuid, closingUuid }` per turn in `$.store` under the session id; #9 already settles that store. For history the Mod didn't see live (a resume of a session it never indexed, the Mod installed mid-session, a gap left by a reload), backfill from the transcript file while it is under 4 MiB. Past that, backfill from `ui.render` observations, matching `(requestId, text)` pairs in order against `$.session.messages()` rows.

### Mapping `$.session.messages()` rows to stored rows

The probe saw `$.session.messages()` return one `SessionMessage` per stored `user`/`assistant` row, in order. Attachment rows (`type: "attachment"`) and command/notice rows (`type: "system"`) were left out. The thinking row came back as an assistant message with `text: ""`, and the tool_result row as a user message with `text: ""` and `toolResults`. Example from the probe (7 rows):

```
user "Reply with the single word alpha." · assistant "" (thinking) · assistant "alpha" ·
user "Use Bash to run: echo hi…" · assistant "" (1 toolUse) · user "" (1 toolResult) · assistant "done"
```

So an ordinal zip of `messages()` with the `type ∈ {user, assistant}` rows from `session.append` or the file lines up one to one. The probe did not check whether `isMeta` user rows (reminders, nudges) also appear in `messages()`. Match on text as well, rather than position alone. `messages()` also caps at the newest 4096 entries (`d.ts:2802`).

## Stability

| Case | Stable? | Evidence | Confidence |
|---|---|---|---|
| Within a session | Yes. The id is the stored row's uuid, "the same in the transcript file and on every later read" (`d.ts:11011-11013`, `11108-11110`). | observed | High |
| **Mod reload** (hot reload of a `--plugin-dir` folder) | Yes. After the reload, `session.start` fired again with the same session id, and every drawn row rendered again with **the same requestIds**. Module memory is lost and `session.append` does not replay, so keep the index in `$.store`/`$.state`. | observed | High |
| **Resumed session** | Expected yes. Resume loads rows from the transcript file, where each line keeps its `uuid` (checked on an existing transcript: every user/assistant line has `uuid`). The types promise the same id "on every later read". | inferred. **Not observed**, because sessions spawned from inside this agent's Claude Code session don't persist a transcript, so there was nothing to `--resume` | Medium-high |
| **Row scrolled out of the viewport** (`onScreen: null`, still mounted) | Yes. `$.ui.scroll` to a prompt and to a reply that sat about 250 rows above the viewport answered `{}`, and the row came into view (`onScreen.first: 0`), on both the default terminal and `CLAUDE_CODE_NO_FLICKER=1`. | observed | High |
| **Row no longer mounted** (a very long session) | Unknown. `UiSelection` says a row can have "scrolled out of the rows the transcript keeps drawn" (`d.ts:15186-15189`). A requestId with no drawn row answers `{ deny: "nothing drawn under that requestId" }` (observed with a made-up id). Whether the engine mounts an unmounted row on demand for `ui.scroll` is not documented, and the probe didn't test it. | open | n/a |
| Desktop surface | Not tested. The id is the stored row's uuid, so it shouldn't depend on the surface, but `onScreen` units differ per surface (`d.ts:6921-6952`). | open | n/a |

### Other constraints on the jump

- A transcript row moves **only while the plugin answers the person's own input** (`d.ts:2561-2575`, `14944-14950`). Otherwise the call is denied with `not person-initiated`. The probe called scroll from a `/probe` command the person typed, and it worked. A Topics-pane `Button` press should count as the person's input, but the probe didn't test it.
- `$.ui.scroll` returns `{ deny }` rather than throwing (`d.ts:15100-15113`), so the pane can show "not available" for a dead jump.

## Open unknowns (worth a follow-up probe)

1. Is a resumed row's render requestId the file's `uuid`? (Run the probe with `claude --resume` from a normal terminal, not from inside an agent.)
2. Very long sessions: does `$.ui.scroll` reach a row the terminal has unmounted, or deny it?
3. Does a pane `Button` press count as person-initiated for transcript scrolls?
4. After `/compact`, which pre-compaction uuids are still drawn and scrollable? (Overlaps the compaction research on #9.)
5. Do `isMeta` user rows appear in `$.session.messages()`?

## Probe

`research/message-request-id-probe/` is a minimal Mod (`rid-probe`) that logs, per module load, to `$RID_PROBE_DIR/load-<ts>.jsonl`:

- every main-conversation `session.append` row (uuid, door, type, role, text)
- every `UserMessage` / `AssistantMessage` render (requestId, text, onScreen)
- `/probe`, which dumps `$.session.messages()` and `$.ui.selection()`
- `/probe scroll <id>`, which calls `$.ui.scroll({ to: { requestId: id }, block: "start" })` and logs the answer

It passes `claude plugin validate`. It was driven with `expect` in a 140×40 pty (`claude --plugin-dir … --model haiku`). The runs were:

1. two prompts, one of them with a Bash call, then a hot reload
2. a 250-line reply that pushed earlier rows out of view, on the default renderer and on `CLAUDE_CODE_NO_FLICKER=1`

Excerpt (run 1):

```
append  uuid=1b4c1cde… door=prompt   "Reply with the single word alpha."
render  User rid=placeholder          "Reply with the single word alpha."   ← optimistic row
render  User rid=1b4c1cde…            "Reply with the single word alpha."
append  uuid=a13022e6… door=response [thinking]
append  uuid=1ea4f6f9… door=response "alpha"
render  Asst rid=1ea4f6f9… first=true "alpha"
append  uuid=4c0d4b38… door=response [tool_use]
append  uuid=e1c398e7… door=response "done"
render  Asst rid=e1c398e7… first=true "done"
scroll  rid=1b4c1cde… → {}
scroll  rid=00000000-… → {"deny":"nothing drawn under that requestId"}
-- hot reload: new load, session.start again (same session id) --
render  User rid=1b4c1cde… · Asst rid=1ea4f6f9… · User rid=2f856917… · Asst rid=e1c398e7…
scroll  rid=1b4c1cde… → {}
```
