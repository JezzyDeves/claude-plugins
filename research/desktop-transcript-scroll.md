# Does `$.ui.scroll` reveal a transcript row on desktop?

Research for [#11](https://github.com/JezzyDeves/claude-plugins/issues/11), part of the map [#9](https://github.com/JezzyDeves/claude-plugins/issues/9) (session-topics Mod).

## Answer

**No, not in this build.** In a session hosted by Claude Code Desktop, `$.ui.scroll({ to: { requestId } })` resolves `{ deny: "transcript not scrollable here" }`, even when it is answering a Button press in the pane. Nothing moves. The person's press does count as their own input there; the call fails anyway because the engine has no way to scroll the desktop's transcript. The engine's control protocol has no message for revealing a transcript row on a remote surface.

`$.ui.scroll` does work on desktop for the plugin's **own sites**: `{ key }`, `"start"` and `"end"` inside its pane or the band. The engine sends those to the desktop as a `ui_scroll` message.

The answer is the same in 2.1.302 (the build the skill's types come from) and 2.1.310 (the installed `claude`).

**Confidence: high** for the engine side. The engine's own shipped code shows the call has no path to a desktop transcript. **Not verified**: a real desktop session. No desktop app was driven for this research.

## How the engine handles a `{ requestId }` target

Claude Code 2.1.302 is a Bun binary that embeds its JS. The excerpts below are minified but readable, and come from `~/.local/share/claude/versions/2.1.302`. The same strings and structure are in 2.1.310.

1. **Dispatch** (`$.ui.scroll`'s core `run`). A `{ requestId }` naming one of the plugin's own sites is refused with `"nothing around that site scrolls"`. Any other `requestId` goes to the transcript path:
   ```js
   return EDe(n,r.requestId).length>0?{deny:"nothing around that site scrolls"}:Yht(r.requestId,s,n)
   ```
2. **Transcript path.** It reads `transcript` off the session binding that is currently bound. With none bound, it denies before checking who initiated the call:
   ```js
   async function Yht(e,n,r){let s=ey()?.transcript;if(!s)return{deny:"transcript not scrollable here"};
     if(!vO(r))return ...{deny:"not person-initiated"};
     let h=await s.reveal(e,n);switch(h){case"revealed":return{};
       case"unknown":return{deny:"nothing drawn under that requestId"};
       case"unscrollable":return{deny:"transcript not scrollable here"}}}
   ```
   `ey` is `GR.current`, the session binding.
3. **Who provides `transcript.reveal`.** There are only two session bindings:
   - **`ReplSessionScope`** (the interactive terminal REPL), `surface: "terminal"`: `transcript:{reveal:(A,L)=>this.requireHost().revealInTranscript(A,L)}`. Its host binds `revealInTranscript: dl.reveal`, which is the Ink scroll-pin class. That class scrolls the terminal's own ScrollBox: `reveal=async(h,A)=>{let L=this.revealRef.current;if(!this.viewport.handle||!L)return"unscrollable"; ...}`.
   - **The headless (`-p` / SDK) binding**, `E_={surface:null, ...}`. It has **no `transcript` key** and no `view` key. Its `compact` throws `"not available in a headless (-p / SDK) session yet"`.
4. **Desktop sessions are headless.** reference.md says so: "In a session a host runs headless (the desktop app)", and `$.ui.notify` lists "the desktop" with `-p` and the SDK as "the hooks alone run". The desktop is a remote surface that "asks over the wire" (`RenderSurface` doc in `claude-code.d.ts`).
5. **No wire message for a reveal.** These are every `ui_*` subtype of the control protocol in 2.1.302 and 2.1.310: `ui_render`, `ui_press`, `ui_input`, `ui_select`, `ui_client_*`, `ui_message`, `ui_pane_show`/`_focus`, `ui_close`, `ui_prompt_*`, `ui_attach`/`_detach`, `ui_invalidate`, `ui_log`, `ui_toast`, `ui_status`, `ui_panes`, `ui_scroll`, `ui_focus`, `ui_copy`, `ui_read_selection`. `ui_attach` lists every engine request a client may answer for a plugin: "`ui_copy` (its clipboard), `ui_prompt_read` / `ui_prompt_fill` / `ui_prompt_suggest` (its composer), `ui_read_selection`". It has no transcript reveal. `ui_scroll` is the engine pushing a **site's** window: `{client_id, component: "Pane"|"AbovePrompt", instance_id, offset, follow_end?}`. It never names a message.

## What the types and reference say (and leave out)

- `$.ui.scroll` (`claude-code.d.ts` ~2562): "A transcript row moves only while this call answers the person's own input, **where one scrolls**." The last clause is the only hint that some hosts have no scrollable transcript. Nothing names a surface.
- `UiScrollResult.deny` (~15100) lists the reasons: a hook kept the window, the target is not this plugin's, `the window moved meanwhile`, `not person-initiated`, "or none scrolls", and `no-surface`. The engine's actual strings for a transcript target are `transcript not scrollable here`, `not person-initiated`, and `nothing drawn under that requestId`.
- `UiScrollArgs` (~14951): "a transcript row is the person's to move, so it is revealed only while the plugin answers the person's own input."
- `UiScrollComponent` is `'Pane' | 'AbovePrompt'`. The `ui.scroll` **event** covers only a plugin's own sites. A transcript reveal raises no `ui.scroll` event, so no hook can see it or answer it.
- `ui.press` / `UiPressArgument.surface` (~14894): a desktop press arrives with `e.surface === "desktop"`. A press is the person's own input on any surface: the engine's check `vO` accepts a root event of `ui.press`, `ui.input` or `ui.select`. On desktop the call is denied before that check runs.
- `UserMessage` / `AssistantMessage` are "Raised on every attached surface", and their `requestId` is the message id (`RenderInputOf.requestId`). The ids a desktop transcript draws under are the same ids, but the engine has no desktop transcript it can scroll to them. Their `onScreen` is "absent where the surface does not say". Whether the desktop reports it is unknown.
- `reference.md` does not mention `$.ui.scroll`. Its parallel `$.ui.view` passage (person-initiated only) is the closest.

## Differences from the terminal

| | Terminal (interactive REPL) | Desktop (headless host) |
|---|---|---|
| `$.ui.scroll({ to: { requestId } })` from a pane press | Reveals the row (`{}`) when the transcript is a scroll box | `{ deny: "transcript not scrollable here" }` |
| Same call not from the person's input (timer, turn, load) | `{ deny: "not person-initiated" }` | `{ deny: "transcript not scrollable here" }` (the transcript check runs first) |
| `requestId` not among the drawn messages (e.g. compacted away) | `{ deny: "nothing drawn under that requestId" }` | n/a |
| `block` (`start`/`center`/`end`/`nearest`) | Passed to the scroll box's `scrollToElement` | n/a |
| Own-site scroll (`{ key }`, `start`/`end` with `in`) | Works | Works: sent to the client as `ui_scroll` |
| Pane placement | `dock` beside a fullscreen transcript (110+ columns), otherwise `inline` above the prompt | The client decides once it reports `isFullscreen`. Opens the person asked for are placed at any width |

**Terminal caveat (likely, not fully traced):** the terminal reveal needs `viewport.handle`, the fullscreen ScrollBox. The REPL passes that viewport only on its fullscreen paths. On the main screen (scrollback), expect `transcript not scrollable here` on the terminal too. This lines up with `$.ui.selection` being fullscreen-only.

**Edge case (unknown):** if a desktop client ever attaches as a surface to an *interactive terminal* session (a REPL keeps a roster of remote surfaces), the bound scope is `ReplSessionScope`. A desktop press would then scroll the **terminal's** transcript, not the desktop page. Whether Desktop attaches that way was not determined.

## What `claude plugin test` can and cannot show

Probe: [`research/probes/scroll-probe/`](probes/scroll-probe/). It is a Pane with a Jump Button whose `onPress` calls `$.ui.scroll({ to: { requestId: 'msg-1' }, block: 'start' })` and draws the answer. `claude plugin validate` passes. `claude plugin test` (2.1.310) gives 3 of 3 passes, which showed:

- On both `terminal` and `desktop` mounts, the press reaches the mod identically: `ui.press` with `{ plugin, element: "jump", component: "Pane", requestId: "probe", surface }`.
- In the kit, a plugin's own `$.ui.scroll` **rejects** with `HooksError: no implementation for ui.scroll` on every surface. That happens even though the error text says a test can answer with `on('ui.scroll', ...)`: neither an `on('ui.scroll')` nor an `on('*')` test hook sees the plugin's call.
- The test's own `$.ui.scroll(...)` does reach a test hook. The event exists in the kit, but a plugin's call skips it.

So the kit cannot show what the engine answers on desktop. It has no transcript, no session binding and no paint ("never a surface's paint", `claude-code.d.ts` header). The answer above comes from the engine's code. A mod's tests can cover the press and the UI the mod draws around the jump. They cannot cover the jump itself. They need the mod to survive `$.ui.scroll` rejecting, as the probe's `try/catch` does.

## Implications for session-topics (input to other tickets)

- On desktop, a pane row press **cannot** move the transcript. The spec has to choose a desktop behaviour. Options: hide or disable the jump affordance when `e.surface === "desktop"`; keep the rows and show a toast or inline note on a deny; or drop "jump" from the desktop promise for v0.1.
- Always read the `deny`. Branch on `transcript not scrollable here` (desktop, or the non-fullscreen terminal) and `nothing drawn under that requestId` (a row that is no longer drawn, which is relevant to compaction and resume).
- Tests should wrap the call so it survives the kit's rejection, and should assert on the press and on the mod's fallback UI, not on scrolling.

## Open unknowns

- Behaviour in a real Desktop session (not driven here). This would confirm the deny string and show whether Desktop paints a pane at all, and where.
- Whether a future Desktop release adds a reveal request. Check the `ui_attach` request list and `ey()?.transcript` in newer builds.
- Whether Desktop reports `onScreen` for message rows.
- Exactly which terminal modes reveal (fullscreen only is the likely reading).

## Sources

- `claude-code.d.ts`, 2.1.302 plugin-authoring skill: `$.ui.scroll` ~2562; `$.ui.view` ~2620; `Elements.desktop` ~3923; `ui.scroll` event ~4142; `PaneOpenArgs` ~7550; `RenderInputOf.requestId` ~10145; `UserMessage`/`AssistantMessage` ~10205–10305; `Pane` props ~10732; `RenderSurface` ~10793; `UiOpenResult` ~14821; `UiPressArgument` ~14894; `UiScrollArgs`…`UiScrollTarget` ~14943–15130; testing kit ~15590–16650.
- `reference.md`, same folder: headless desktop (`$.ui.selection`, `$.ui.notify` passages); `$.ui.view` person-initiated rule; testing paragraph.
- Engine binaries `~/.local/share/claude/versions/2.1.302` and `2.1.310`: functions `oJn` (dispatch), `Yht` (transcript reveal), `vO` (person-initiated check), `ReplSessionScope` (`transcript.reveal`), headless binding `E_={surface:null,…}`, scroll-pin `reveal`, control-protocol `ui_*` schemas.
- Probe run: `claude plugin validate` and `claude plugin test` on `research/probes/scroll-probe` with claude 2.1.310.
