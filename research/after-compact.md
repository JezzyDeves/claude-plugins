# What a Mod sees after `/compact`

Research for [#12](https://github.com/JezzyDeves/claude-plugins/issues/12), part of the session-topics map [#9](https://github.com/JezzyDeves/claude-plugins/issues/9).

Sources:
- The `plugin-authoring` skill bundled with Claude Code **2.1.302**: `types/claude-code.d.ts` (cited as `d.ts:<line>`) and `reference.md`.
- A probe Mod (`research/after-compact-probe/`, see [Probe](#probe)), run on the installed CLI **2.1.310** in three ways: headless `claude -p --resume`, one headless process fed through `--input-format stream-json`, and a real interactive terminal session driven through a pty.

Sibling research: [`research/message-request-id.md`](https://github.com/JezzyDeves/claude-plugins/blob/research/message-request-id/research/message-request-id.md) (#10) established that a transcript row's render `requestId` is its stored `uuid`. This note builds on that.

## Answer

There are two cases, and they behave differently.

| | **Live session, after `/compact`** (same process) | **Resumed session** (`--resume` of a compacted session) |
|---|---|---|
| `$.session.messages()` (rows) | **Full history.** The pre-compaction rows, then the summary as a `user` row, then the kept rows, then the `/compact` command rows (observed) | **Post-boundary rows only.** The summary, the kept rows, the command rows, then later turns. Pre-compaction prompts are gone (observed) |
| `$.session.messages({ as: "api" })` | Post-compaction only: the summary in place of what it replaced (`d.ts:659-666`, observed) | Same (observed) |
| Pre-compaction rows on screen | **Still drawn** (observed) | **Not drawn** (observed) |
| `$.ui.scroll({ to: { requestId } })` to a pre-compaction row | **Works.** It returns `{}`, and the row lands at the top of the viewport (`onScreen.first: 0`) (observed) | **Denied** with `nothing drawn under that requestId` (observed) |
| Same, to a kept or post-compaction row | Works (observed) | Works. The resumed row's requestId is the transcript file's `uuid` (observed) |

**Hookable events.** `session.compact` is the Mod-level event (`d.ts:4483-4494`). It fires for every trigger: `manual`, `auto`, `plugin` and `precompute` (`d.ts:11277-11284`). The cleaner way to keep Topics in step is to wrap it with `const r = await next(e)`. Then:

- `e.messages` is the conversation before the compaction.
- `r.messages` is the conversation after it.
- `r.skip` set means the compaction was vetoed.
- `e.trigger === "precompute"` installs nothing, so ignore it.

Inside that hook, **`$.session.messages()` still returns the old list** even after `next(e)` resolves. The new transcript is installed after the chain returns (observed). Two other signals fire after the install:

- `session.append` with `door: "compaction"`. A row with `type: "system"` and `name: "compact_boundary"` comes first, then the summary row (`d.ts:10984`, `11040-11046`, observed).
- The settings-hook events `classic.PostCompact` and `classic.SessionStart` with `source: "compact"` (`d.ts:7953-7959`, `12131-12133`, observed).

The plugin `session.start` event does **not** fire on a compaction. It fires once per process (`d.ts:4436-4446`).

**Confidence: high** for the manual `/compact` on the terminal, which the probe observed in all three run modes. **Medium** for `auto` and `plugin`: the types cover them, the probe didn't run them. Desktop wasn't tested.

## Details

### `$.session.messages()` in a live session after compaction

The interactive terminal probe, two turns, then `/compact` (rows abbreviated):

```
before:  user:apple · assistant:Apple · user:"Print 1..90" · assistant:"1 2 3 …"
after:   user:apple · assistant:Apple · user:"Print 1..90" ·
         user:"This session is being continued from a previous conversation…"   ← summary
         assistant:"1 2 3 …"                                                    ← kept row, moved after the summary
         user:"<command-name>/compact</command-name>…" · user:"<local-command-stdout>Compacted…"
api:     user:summary · assistant:"1 2 3 …" · user:<reminders>
```

- **The kept tail keeps its uuid.** Compaction kept the last assistant reply (`r.messages` = `[summary, that reply]`). It was appended again through `session.append` with its **original `uuid`** and original door (`response`), so its requestId and jump stay valid. A Mod that indexes `session.append` must **de-duplicate by uuid**.
- **The kept row moves after the summary.** In the interactive rows list, the kept reply sits after the summary, while its prompt stays before it. So an ordinal zip of `messages()` against stored rows sees the summary between a prompt and its reply. In the one-process headless (`stream-json`) run the kept row instead appeared **twice**, once before the summary and once after it. Don't rely on `messages()` order across a compaction boundary. Index by uuid from `session.append`.
- **The summary and command rows are plain `user` rows** in `messages()`. Tell them apart:
  - At append time: the summary arrives with `door: "compaction"`, and the `/compact` echo and its output with `door: "command"`. The `isMeta` caveat row was left out of `messages()` (observed).
  - By text alone: the summary starts with "This session is being continued from a previous conversation", and command rows start with `<command-name>` or `<local-command-stdout>`. That is a fragile fallback.
- **`$.session.turns()` counts those rows too.** It went 2 → 5 across one `/compact` with no new prompt (observed). Don't use it as a prompt count.
- The 4096-entry cap (`d.ts:2802`) applies to a list that, in a live session, keeps growing across compactions.

### `session.compact` hook payload

A run of `/compact` in the probe, with abbreviated logs:

```
compact.in   trigger=manual  n=4  [user#apple, assistant#Apple, user#"Print…", assistant#"1 2 3…"]   (# = has handle)
compact.out  n=2  [user#"This session is being continued…", assistant#"1 2 3…"]  tokensBefore=53466 tokensAfter=14216
after next:  $.session.messages() → still the 4 old rows (+ the /compact echo)
then:        append door=compaction  system compact_boundary "Conversation compacted"
             append door=compaction  user  "This session is being continued…"
             append door=response    <kept row, same uuid as before>
             append door=command     /compact caveat, echo, stdout
```

- `SessionMessage.handle` is set only on the messages a `session.compact` hook receives and returns (`d.ts:11641-11647`, `11189-11191`, `11246-11250`). It is opaque and carries no uuid, so it can't be mapped to a requestId.
- `SessionCompactResult` holds no summary string: "the summary is a message" (`d.ts:11255-11261`). `classic.PostCompact` does carry `compact_summary` as a string (`d.ts:7953-7959`).
- A Mod could pass `instructions` down with `next({ ...e, instructions })` (`d.ts:11238-11244`). For example, it could ask the summarizer to keep topic boundaries. That's an option, not a need.

### Rendering and scroll

- **Live session:** after `/compact`, `ui.render` kept reporting the pre-compaction `UserMessage` and `AssistantMessage` rows under their original requestIds. A single `/probe-scroll` to the first pre-compaction prompt returned `{}`, and the next renders showed that prompt and its reply at `onScreen: { first: 0 }`. So the transcript keeps drawing the old rows above the compaction, and they stay valid jump targets (observed).
- **The `/compact` echo row is a dead target.** It rendered as a `UserMessage` with its own requestId. After the compaction a scroll to it was denied (`nothing drawn under that requestId`), because the stored command rows replace it. This doesn't matter for Topics, which shouldn't index command rows.
- **Resumed session:** the transcript drew only the kept reply and the rows after the boundary. Scrolls to the two pre-compaction prompts were denied. Scrolls to the kept reply and to the post-compaction prompt worked (observed). This also answers #10's open question 1: **a resumed row's render requestId is the file's `uuid`** (`acdbad26…` in both the file and `ui.render`).
- Transcript rows move only while the call answers the person's own input (`d.ts:2561-2575`). The probe scrolled from a slash command the person typed.

### The transcript file across a compaction

The JSONL file is append-only, so pre-compaction rows stay in it. The `compact_boundary` line has `parentUuid: null` and a `logicalParentUuid` pointing at the last pre-compaction row. The summary line has `isCompactSummary: true` (observed in the probe's headless session file). Resume loads the chain from the last boundary, which is why pre-compaction rows neither render nor appear in `messages()` on resume. A Mod can still read their text from the file (`$.fs.read(transcript_path)`, under 4 MiB, per #10), but can't jump to them.

## What this means for session-topics

The compaction and resume behaviour still marked "Not yet specified" on #9 can be settled from this:

1. **Live `/compact`:** keep every Topic and every jump. Nothing that was jumpable stops being jumpable, except the `/compact` echo, which Topics doesn't index. Optionally show a "compacted here" marker at the boundary, detected from `session.append` with `door: "compaction"` and `name: "compact_boundary"`.
2. **Resume of a compacted session:** Topics stored in `$.store` from before the last compaction can still be listed, but their jumps are dead. The pane should show them as not jumpable (the `{ deny }` from `$.ui.scroll` confirms it at press time). Jumps from the kept tail onward work.
3. **Hook:** use `session.compact` (wrap `next`, skip `precompute` and `skip` results) to learn that a compaction happened and what it kept. Use `session.append` with `door: "compaction"` and uuid de-duplication to update the live index. Don't read `$.session.messages()` inside the compact hook.
4. **Don't drive topic splitting from `messages()` order across a boundary.** Index by uuid from `session.append`, and filter out `door: "compaction"` and `door: "command"` rows.

## Open unknowns

- **`auto` and `plugin` triggers.** Expected to match `manual`: same event and same `next` result per the types. Not observed.
- **Desktop surface.** Is pre-compaction history still drawn and scrollable there after `/compact`? Not tested. The desktop transcript-scroll research may cover it.
- **Interactive resume vs. ctrl+o.** Does the ctrl+o transcript view of a resumed session show the pre-compaction rows? Not tested. It wouldn't make them scroll targets for `$.ui.scroll` in the main view.
- **A second compaction in one live session.** Do the rows from before the first compaction stay drawn? Not tested, but expected, since the live list only grows.
- **Very long live sessions.** The interaction of the 4096 `messages()` cap and the rows the terminal keeps mounted with long pre-compaction history is untested (#10 open unknown 2).
- Probe caveat: sessions started interactively from inside this agent's own Claude Code session weren't persisted to disk (also noted in #10). The resume case was probed by resuming a session made with `claude -p` that was compacted headlessly.

## Probe

`research/after-compact-probe/` is a throwaway Mod that logs JSON lines to `<plugin root>/probe.log`:

- `session.compact`: logs the input and the `next` result, then `$.session.messages()` right after.
- `session.append`: every non-attachment row, with its `door`, `uuid` and `name`.
- `turn.complete`: logs both forms of `messages()`.
- `classic.PostCompact` and `classic.SessionStart`: logs each.
- `ui.render` on `UserMessage` and `AssistantMessage`: logs the requestId and each change of `onScreen`.
- `/probe-dump`: logs `messages()` in both forms.
- `/probe-scroll [id|first]`: scrolls the transcript to that id, to the first rendered row, or to every rendered row in turn, and logs each `$.ui.scroll` result.

Runs:

1. Headless, three processes: `claude -p --plugin-dir research/after-compact-probe --model haiku "…apple"`, then `--resume <id>` with "…banana", then `--resume <id> "/compact"`, then `--resume <id> "…cherry"`.
2. Headless, one process: `--input-format stream-json` fed apple, banana, `/compact`, `/probe-dump`, cherry.
3. Interactive terminal through a pty, 120×40: apple, a 91-row reply, `/probe-scroll`, `/compact`, `/probe-dump`, `/probe-scroll`, cherry, `/probe-scroll`.
4. Interactive `claude --resume` of run 1's compacted session, then `/probe-scroll` to two pre-compaction prompt uuids, the kept reply's uuid and the post-compaction prompt's uuid.
5. Interactive, a single-target check: apple, the 91-row reply, `/compact`, `/probe-scroll first`.
