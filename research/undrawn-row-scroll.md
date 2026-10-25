# Can `$.ui.scroll` reach a transcript row the terminal has stopped drawing?

Research for [#19](https://github.com/JezzyDeves/claude-plugins/issues/19), part of the map [#9](https://github.com/JezzyDeves/claude-plugins/issues/9) (session-topics Mod). Builds on [#10](https://github.com/JezzyDeves/claude-plugins/issues/10) (a row's render requestId is its uuid), [#11](https://github.com/JezzyDeves/claude-plugins/issues/11) (reveal goes through `transcript.reveal` on the terminal) and [#12](https://github.com/JezzyDeves/claude-plugins/issues/12) (what survives `/compact`). Leaves "main screen vs fullscreen" to [#16](https://github.com/JezzyDeves/claude-plugins/issues/16), except where it decides the answer here.

## Answer

**Yes, on the fullscreen terminal. Rows that virtual scrolling has unmounted are still reachable, and no row count caps that.** The reveal looks the requestId up in the transcript's **whole message list**, not in the rows that happen to be mounted. If the row isn't mounted, the engine scrolls to its estimated offset, which mounts it, then lands it with `block`. A probe confirmed it: a prompt more than 600 rows above the viewport, beyond the mounted window, answered `{}` in about 25 ms and showed at the top of the viewport.

**"Nothing drawn under that requestId" doesn't mean "scrolled too far away".** It means the id isn't in the list of messages the transcript renders at all, or the row couldn't be landed within 3 s. On the fullscreen terminal that list holds every message in the live session, minus:

| Why the id is gone | Applies to Topics? | Source |
|---|---|---|
| **Resumed compacted session**: rows from before the last compaction aren't loaded | Yes, the main case | #12 (observed); fullscreen docs: "scrolling up stops at the `Conversation compacted` row" |
| **`/rewind`** past the row, or `/clear` | Yes: those turns are gone | Inferred: the live list no longer holds them. Docs say a relaunch after `/rewind` carries "the conversation as it appears on screen" |
| Display filters: `isMeta` user rows, transcript-only rows, thinking-only assistant rows, rows folded into a scheduled-task fire | No: a typed prompt and a text reply are never filtered | Engine filters `uIo`, `Ls`, `Pm` |
| **Brief mode**: in a turn where the Brief tool (or `SendUserFile`) ran and succeeded, the assistant's text rows are dropped | Edge case: the closing reply isn't drawn, so jump to the prompt | Engine filter `Vw`, gated on `isBriefEnabled` |
| A made-up or wrong id | — | Observed: `{ deny: "nothing drawn under that requestId" }` |

Tool rows that are grouped or collapsed (`grouped_tool_use`, `collapsed_read_search`) still resolve: the lookup matches the uuids of their members.

**The row caps exist, but only where the reveal can't run anyway.** The classic main-screen renderer caps the transcript at the newest 400 messages, then 200 rendered rows, with 50 rows of slack. Fullscreen with `CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL=1` goes through the same caps; the 200 may shrink to the terminal's row count, depending on a flag this research didn't trace. Neither renderer mounts the virtual list that provides the reveal, so every jump there is denied `transcript not scrollable here` before the cap matters. Observed with `DISABLE_VIRTUAL_SCROLL`; for the main screen, see #16.

**Can a Mod bring a missing row back?** No. Nothing in the API adds a message to the transcript's list or loads pre-compaction history into it. `$.ui.scroll` only reveals ids already in the list. An unmounted row needs no help: the reveal remounts it. For an old Topic in a resumed compacted session, its turns are gone from the drawn list for good. Show them as not jumpable; the deny confirms it at press time.

**Confidence:** high. The engine code was read in 2.1.310 (the installed build), and the same mechanism and constants are in 2.1.302 under other minified names. The probe ran in a real 140×40 interactive pty on 2.1.310. Not verified: sessions of thousands of turns (see the 3 s give-up below), and pressing a jump from a pane Button rather than a typed `/command`.

## How the reveal finds a row (engine, 2.1.310)

Claude Code is a Bun binary that embeds its JS. The excerpts below are minified, from `~/.local/share/claude/versions/2.1.310`.

1. **Session scope → scroll-pin.** `$.ui.scroll({ to: { requestId } })` reaches `transcript.reveal` on `ReplSessionScope`, which calls the scroll-pin class (#11):
   ```js
   reveal=async(h,x)=>{let D=this.revealRef.current;if(!this.viewport.handle||!D)return"unscrollable";
     let H=D.reveal(h,x);if(!H)return"unknown";return this.#i=!0,await H?"revealed":"unknown"}
   ```
   `"unscrollable"` maps to `transcript not scrollable here`, and `"unknown"` to `nothing drawn under that requestId`.
2. **`revealRef` is set only by `VirtualMessageList`.** The Messages component renders it only when `Y = scrollViewport != null && !CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL`. Otherwise it renders `messages.flatMap(renderItem)` and `revealRef.current` stays `null`. So the main screen and fullscreen without virtual scroll both answer `unscrollable`.
3. **Lookup over the whole list.** `VirtualMessageList`'s imperative `reveal`:
   ```js
   reveal:(re,Z)=>{ae(!0);let{messages:me}=$e.current,Le=Ew(me,re);if(!h.handle||Le<0)return null;
     return new Promise((Ye)=>{Y.current={request:{kind:"reveal",requestId:re,block:Z,done:Ye},idx:Le,...,
       cancelGiveUp:to.setTimeout(()=>ae(!1),kw)},Bt(!0)})}
   ```
   `messages` is the full list handed to the virtual list, not the mounted slice (`m.slice(ce,et)` is what mounts). `Ew` matches `m.uuid === id`, or a member of a `grouped_tool_use`/`collapsed_read_search`, then falls back to a uuid that shares a prefix (`UD`, `Ew`).
4. **Mount on demand.** The landing step `Bt` runs after every render (`P(()=>Bt(!0))`). If the row's element isn't mounted, it calls `scrollToIndex(idx)`, which scrolls to the estimated offset so the window mounts it, and tries again on the next render. Once the element has a layout it calls `scrollToElement(el, 0, { block })` and `done(true)`:
   ```js
   let lt=ze(Z.idx);if(!lt){if(re)Ge(Z.idx),...;return} ...
   case"reveal":if(me.scrollToElement(lt,0,{block:Be.block}),!je)Be.done(!0)
   ```
5. **Give-up and races.** `kw=3000`: a row that hasn't landed within 3 s resolves `done(false)`, which becomes `nothing drawn under that requestId`. If the list changes and the id is no longer in it, `done(false)` fires at once. A new reveal, or the person scrolling, releases a pending one with `done(true)`, so an interrupted jump can report `{}`.

### What virtual scrolling mounts

`yw` (the virtual window) mounts, while pinned to the bottom, only the newest items whose heights sum to the viewport plus overscan. The overscan is `ZE(h) = max(60, min(round(1.5·h), 80))` rows. It grows to the viewport plus 2× overscan, at most `Fl=300` items. Unmeasured items are estimated at 3 rows. Everything older is a spacer. This is what the docs mean by "only renders messages that are currently visible … memory stays constant regardless of conversation length". The data stays in the list; only the React rows unmount.

### Caps outside virtual scrolling (for completeness)

In the Messages component (`Iv`): `ts=30, _v=50, Ww=200`; `ae = jw(rows, _i())`, which is 200, or min(200, rows) when the imported flag `_i()` is set. That flag wasn't traced; it is likely the fullscreen flag.

- `tt = !Y && !uncapped ? ql(messages, preCap, ae*2) : 0`. The raw list is cut to the newest 400 once it passes 450.
- `Df = !Y && !uncapped ? ql(rows, slice, ae) : 0`. The rendered rows are cut to the newest 200 once they pass 250.
- Transcript mode (ctrl+o) without virtual scroll shows the last 30 (`hasTruncatedMessages`, Ctrl+E shows all).

All of these are `!Y` paths, where the reveal is already `unscrollable`.

## What the types and docs say

- `$.ui.scroll` (`claude-code.d.ts` ~2562): a transcript row moves "while this call answers the person's own input, where one scrolls". The types say nothing about mounting or distance.
- `UiSelection` (~15189) mentions rows "scrolled out of the rows the transcript keeps drawn". That is about selection, not scroll targets.
- `onScreen` (~10256): `null` "while drawn outside" the viewport. The probe saw `null` for the far-off prompt before the jump, and `{first:0,…}` right after.
- `CommandPresentation.isFullscreen` (~1796): "false on the main screen (`CLAUDE_CODE_NO_FLICKER=0`, tmux by default)". A Mod can read it on `command.run` (`e.presentation.isFullscreen`) and on `RenderViewport.isFullscreen`. But fullscreen with `CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL=1` reports `true` and still can't reveal (observed). Only the deny tells.
- Docs, [env vars](https://code.claude.com/docs/en/env-vars): `CLAUDE_CODE_NO_FLICKER=1` enables fullscreen, which "keeps memory flat in long conversations". `CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL=1` disables virtual scrolling "and render[s] every message".
- Docs, [fullscreen](https://code.claude.com/docs/en/fullscreen): "Only visible messages are kept in the render tree". For a resumed compacted session, "scrolling up stops at the `Conversation compacted` row". Whether a new session starts in fullscreen depends on setup; see the "Fullscreen by default" table.

## Probe

[`research/undrawn-row-scroll-probe/`](undrawn-row-scroll-probe/) is a Mod (`urs-probe`). It logs main-conversation prompt and response appends, `UserMessage` renders of those prompts with `onScreen`, and scroll answers. Its commands: `/probe` (status), `/probe first`, `/probe last`, `/probe bogus`, `/probe scroll <id>`. It passes `claude plugin validate`. It was driven with `expect` in a 140×40 pty (`claude --plugin-dir … --model haiku`, `TMUX` unset), and the screen was rebuilt from the pty log with `pyte`.

**Run A, default (fullscreen, virtual scroll on).** The steps: "alpha", then a 300-line reply, then a second 300-line reply, so the first prompt sat more than 600 rows above the viewport. Then `/probe first`, `/probe bogus`, `/probe first`.
```
status  fullscreen=true prompts=3 messages=8
scroll  first  rid=ecd09713…  res={}  25ms
render  User   rid=ecd09713…  onScreen={first:0,last:1,of:2}     ← now at the viewport top
scroll  bogus  rid=00000000…  res={"deny":"nothing drawn under that requestId"}
scroll  first  rid=ecd09713…  res={}  26ms                        (again, after the view repinned)
```
The rebuilt screen after `/probe first` starts with `❯ Reply with the single word alpha.`. A first run (A′) gave the same answers.

**Run B, `CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL=1`.**
```
status  fullscreen=true
scroll  first  res={"deny":"transcript not scrollable here"}
scroll  bogus  res={"deny":"transcript not scrollable here"}
```

**Side observation.** A typed `/probe …` row that lands *after* a reveal repins the view to the bottom (`onUserRowLanded` → `repin("ownSubmitLanded")`). Run A's `/probe bogus` did that. A Pane `Button` press adds no row, so this shouldn't affect the Topics pane, but that wasn't tested.

## Implications for session-topics

- On the fullscreen terminal, keep every live-session turn jumpable, however old. No paging or "recent N" limit is needed for the jump.
- After a resume, mark turns from before the last compaction boundary as not jumpable. That is the boundary #12 describes, so the index can know it ahead of time: `session.append` `door: "compaction"`, or the `compact_boundary` row in the transcript file. Also mark turns cut by `/rewind`.
- Always read the deny:
  - `nothing drawn under that requestId`: the turn is gone (resume past a compaction, rewind), or the 3 s landing timed out.
  - `transcript not scrollable here`: the renderer can't jump at all (main screen, `DISABLE_VIRTUAL_SCROLL`, desktop). `isFullscreen` alone doesn't predict this.
- In brief mode, a turn's closing reply may not be drawn. Fall back to the turn's prompt.

## Open unknowns

- **Very long sessions.** With thousands of unmeasured rows (estimated at 3 rows each), does `scrollToIndex` converge within the 3 s give-up? The code retries on every render, so it is expected to, but this wasn't tested past about 8 messages and 600 rows.
- **Pane `Button` press** as the trigger. The press counts as person-initiated (#11's engine reading), but this was only observed from a typed `/command`.
- **ctrl+o transcript mode.** Is a jump from the Topics pane possible while the person has transcript mode open? It renders a separate list, and which instance owns `revealRef` there wasn't traced.
- **`/tui fullscreen` relaunch of a compacted session.** Do the pre-compaction rows survive ("the conversation as it appears on screen"), or does it behave like a resume?
- `/rewind` and `/clear` were inferred from the code and docs, not probed.

## Sources

- `claude-code.d.ts`, plugin-authoring skill 2.1.302: `CommandPresentation` ~1790–1800; `$.ui.scroll` ~2562; `onScreen` ~10256; `OnScreen` ~6934; `UiSelection` ~15189.
- `reference.md`, same folder: `e.viewport.isFullscreen` and `presentation` passages.
- Engine `~/.local/share/claude/versions/2.1.310`:
  - scroll-pin class `BZ` (`reveal`, `repin`, `onUserRowLanded`)
  - `VirtualMessageList` `yp` (imperative `reveal`, landing `Bt`, give-up `ae`)
  - lookup `Ew`/`UD`
  - virtual window `yw` (`ZE`, `Fl=300`, `XE=3`)
  - Messages `Iv` (the `Y` gate, `ql` caps with `ts=30,_v=50,Ww=200`, filters `uIo`/`Ls`/`Pm`/`Vw`)
  - `Mw=250,ED=2000,kw=3000`
- Engine `~/.local/share/claude/versions/2.1.302`: the same structure (`YS`, `kE=3000`, `Jr=30,Yx=50,aw=200`).
- Docs: https://code.claude.com/docs/en/env-vars and https://code.claude.com/docs/en/fullscreen (fetched 2026-10-25).
- Probe runs A, A′ and B above, claude 2.1.310.
