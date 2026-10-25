# Does `$.ui.scroll` reveal a transcript row on the terminal outside fullscreen?

Research for [#16](https://github.com/JezzyDeves/claude-plugins/issues/16), part of the map [#9](https://github.com/JezzyDeves/claude-plugins/issues/9) (session-topics Mod). Builds on [#11](https://github.com/JezzyDeves/claude-plugins/issues/11) ([findings](https://github.com/JezzyDeves/claude-plugins/blob/research/desktop-transcript-scroll/research/desktop-transcript-scroll.md)) and [#10](https://github.com/JezzyDeves/claude-plugins/issues/10) ([findings](https://github.com/JezzyDeves/claude-plugins/blob/research/message-request-id/research/message-request-id.md)).

## Answer

**No.** In an interactive terminal session on the classic (main-screen) renderer, `$.ui.scroll({ to: { requestId } })` resolves `{ deny: "transcript not scrollable here" }`. It does so from a pane Button press and from a typed slash command alike, and nothing moves. With the fullscreen renderer the same calls resolve `{}` and the row is revealed.

- **Fullscreen is the renderer choice.** `/tui fullscreen` / `/tui default` (saved as the `tui` setting), or `CLAUDE_CODE_NO_FLICKER=1` / `=0` (and `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` forces classic). With none of these set, the engine picks a default per machine and account. On this machine the default was fullscreen. That is why #10's "default terminal" run scrolled.
- **A Mod can detect it before drawing.** Read `e.viewport.isFullscreen` on its `Pane` (or any) `ui.render` input, or `e.presentation.isFullscreen` on its `command.run` input. Both come from the same latched renderer mode and are fixed for the session. On the terminal, `isFullscreen: false` means a transcript jump will be denied (one rare exception is under "Main-screen renderer variants").
- **A Mod cannot ask for it.** No API turns fullscreen on. `$.settings.read` is read-only. Switching means the person runs `/tui fullscreen`, which relaunches the session.
- **A pane Button press counts as the person's own input.** The engine's check accepts a call whose root event is `ui.press`, `ui.input` or `ui.select`. Live, a hotkey press on a focused pane's Button revealed the row in fullscreen. On the main screen the same press passed the person check and was denied only because nothing scrolls there.

**Confidence: high.** It was observed live in a pty with `claude` 2.1.310 (main screen, fullscreen and default runs), and it matches the engine's shipped code.

## Observed (live probe)

Probe: [`research/probes/main-screen-scroll/`](probes/main-screen-scroll/). `/jump` logs `command.run`'s `presentation` and opens a pane (`focus: true`) with two Buttons: hotkey `f` scrolls to the first prompt's row and `l` to the last. `/jump scroll first` does the same from the typed command. Targets are the `uuid`s `session.append` gave the person's prompts. #10 showed those are the rows' `requestId`s. Each run: `claude --plugin-dir <probe> --model haiku` in a 140×40 pty, two prompts (the second a 120-line reply, so the first prompt sits off-screen), then `/jump`, `f`, `l`, Esc, `/jump scroll first`.

| Run | `presentation.isFullscreen` / `viewport.isFullscreen` | Pane placement | Press `f` | Press `l` | Typed `/jump scroll first` | Debug log |
|---|---|---|---|---|---|---|
| `CLAUDE_CODE_NO_FLICKER=0` (main screen) | `false` / `false` | `inline` | `{ deny: "transcript not scrollable here" }` | same | same | `ui.scroll <plugin> to <id>: unscrollable` |
| `CLAUDE_CODE_NO_FLICKER=1` (fullscreen) | `true` / `true` | `dock` | `{}` | `{}` | `{}` | `… revealed` |
| nothing set (this machine's default) | `true` / `true` | `dock` | `{}` | `{}` | `{}` | `… revealed` |
| `NO_FLICKER=0` + `CLAUDE_CODE_DECSTBM=1` | `false` / `false` | `inline` | deny, as main screen | same | same | `… unscrollable` (the DECSTBM renderer most likely did not engage in a bare pty; see below) |

Every press arrived as `ui.press` with `surface: "terminal"`. On the main screen the debug line says `unscrollable`, not `denied, not person-initiated`. So the press passed the person check, and the deny came from the transcript itself.

## How the engine decides (2.1.310, shipped JS in `~/.local/share/claude/versions/2.1.310`)

1. **The transcript path** (`$.ui.scroll` → `Twt`; `Yht` in #11's 2.1.302 notes):
   ```js
   var nv=(e)=>e==="ui.press"||e==="ui.input"||e==="ui.select";
   function uD(e){let[n,...r]=e.origin,s=n!==void 0&&r.length===0;
     return s&&typeof n!=="string"&&e.isPersonInput===!0||s&&nv(e.rootEvent)}
   async function Twt(e,n,r){let s=Xf()?.transcript;if(!s)return{deny:"transcript not scrollable here"};
     if(!uD(r))return t(`ui.scroll ${r.plugin} to ${e}: denied, not person-initiated (root ${r.rootEvent??"none"})`),{deny:"not person-initiated"};
     let h=await s.reveal(e,n);switch(t(`ui.scroll ${r.plugin} to ${e}: ${h}`),h){case"revealed":return{};
       case"unknown":return{deny:"nothing drawn under that requestId"};case"unscrollable":return{deny:"transcript not scrollable here"}}}
   ```
   On the terminal the binding is `ReplSessionScope`, which always has `transcript.reveal`. The person check (`uD`) therefore runs first: a press, input or select root event passes. Then the reveal decides.
2. **The reveal** (the REPL's scroll-pin class, bound as `revealInTranscript`):
   ```js
   reveal=async(h,x)=>{let D=this.revealRef.current;if(!this.viewport.handle||!D)return"unscrollable"; ...}
   ```
   `viewport.handle` is set only when a ScrollBox mounts with `ref: viewport.attach`.
3. **Who mounts that ScrollBox.** The REPL's layout component (`lxt`) has three branches:
   - `if (Zl())`: the fullscreen layout. It renders a ScrollBox `{ ref: z?.attach, stickyScroll: true, … }` around the transcript, so a handle exists.
   - `if (WW())`: the DECSTBM main-screen renderer. Its component (`Gi`) also renders a ScrollBox with `ref: attach`.
   - otherwise: a plain fragment `[scrollable, abovePrompt, bottom, modal]`. The transcript prints into the terminal's native scrollback with no ScrollBox and no handle, so the reveal answers `"unscrollable"`.

   The message list also gets `revealRef` only with a scroll viewport (`Y = scrollViewport != null && !CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL`). The prompt screen passes that viewport only when `_i() || WW()`, where `_i()` is `renderMode === "fullscreen"`.
4. **The renderer choice** (`Zl`, in order). Background session: on. Screen-reader mode: off. `CLAUDE_CODE_NO_FLICKER=0` or `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN`: off. `CLAUDE_CODE_NO_FLICKER=1`: on. A recorded failed fullscreen start: off. iTerm2 `tmux -CC`: off. Windows over SSH: off. Then the `tui` setting (`"fullscreen"` / `"default"`). Then fresh-install and feature-flag defaults (`tengu_amber_creek`, `tengu_pewter_brook`). This matches the "Fullscreen by default" table in the [fullscreen docs](https://code.claude.com/docs/en/fullscreen).
5. **What a Mod sees.** The terminal's render input stamps `viewport: { columns, rows, isFullscreen: _i() }`. `command.run`'s `presentation` is `HXe(mode) = { isFullscreen: mode === "fullscreen", columns }`. Both read the latched render mode, so they agree and do not change mid-session (`/tui` relaunches).

### Main-screen renderer variants

`WW()` (`decstbmRendererEnabled`) is a main-screen renderer that draws through a DECSTBM scroll region. It is on only when all of these hold: stdout is a TTY, not `tmux -CC`, synchronized output is supported, not under tmux, zellij, the JetBrains terminal or Windows Terminal, not fullscreen, not screen-reader mode, and either `CLAUDE_CODE_DECSTBM` is set or the `tengu_marlin_porch` flag is on (default off). From the code, the transcript there is a ScrollBox, so a reveal **should** work while `isFullscreen` reports `false`. Live, `CLAUDE_CODE_DECSTBM=1` in a bare pty still denied. The pty most likely did not report synchronized output, so the renderer never engaged. **Unverified.** It is off by default and undocumented. For a Mod this is the one case where `isFullscreen: false` and a working jump could coexist, so read the deny rather than rely on `isFullscreen` alone.

## What the types and docs say

- `CommandPresentation.isFullscreen` (`claude-code.d.ts` ~1794): "True under the fullscreen (alternate-screen) layout; false on the main screen (`CLAUDE_CODE_NO_FLICKER=0`, tmux by default) and headless." It is the same fact as `RenderViewport.isFullscreen` (~10827): "The terminal always says: `true` fullscreen, `false` on the main screen, fixed per session." The "tmux by default" wording is out of date for 2.1.310: the code turns fullscreen off only for `tmux -CC`, and the docs say fullscreen works inside tmux.
- `$.ui.scroll` (~2562): "A transcript row moves only while this call answers the person's own input, where one scrolls." The types never say the main screen is where none scrolls. This research and the engine code show it.
- `reference.md` §Pane: a Button's `hotkey` "presses it while its site holds the keyboard … a pane … opened with `focus`". The probe used exactly that to press from the keyboard.
- `$.settings.read` (~3647) has no write counterpart. Nothing in the types lets a Mod change the renderer.
- Docs, [Fullscreen rendering](https://code.claude.com/docs/en/fullscreen): `/tui fullscreen` saves the `tui` setting and relaunches. `CLAUDE_CODE_NO_FLICKER=1` / `=0` and `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` override it. Screen-reader mode is always classic. Attached background sessions are always fullscreen. The "Fullscreen by default" table depends on first-use date and feature-flag fetching, so the default differs between users.

## Implications for session-topics (input to other tickets)

- Jump rows work only where `isFullscreen` is `true`. On the main screen (and on desktop, per #11) every jump is denied, so the pane needs the same fallback in both places.
- Detection is cheap and synchronous. The Pane's own `ui.render` input carries `e.viewport?.isFullscreen`, and `/topics`'s `command.run` carries `e.presentation.isFullscreen`. Either is enough to draw jump rows as plain text or show a hint. Still branch on the deny, for the DECSTBM case and for rows no longer drawn (#19).
- Where the mode is classic, the pane could say "jumps need fullscreen: run `/tui fullscreen`". The Mod cannot switch the mode itself.
- On the main screen the pane is placed `inline` above the prompt at the terminal's full width. In fullscreen at 110+ columns it is a `dock`. The probe's pane was 77 columns docked in a 140-column terminal.
- A Button `onPress` handler may call `$.ui.scroll` directly. The press is accepted as the person's input. A call from a timer, a turn hook or a load is denied with `not person-initiated`, on the main screen too: the person check runs before the reveal.

## Open unknowns

- The DECSTBM renderer (`CLAUDE_CODE_DECSTBM` / `tengu_marlin_porch`): whether a reveal works there live. The code says it would, and `isFullscreen` would still read `false`.
- Whether a press handler that awaits something slow first (say `$.model.complete`) still counts as person-initiated when it finally scrolls. `uD` reads the call's root event, which should still be `ui.press`, but this was not tested.
- Whether a Mod calling `$.command.run({ command: 'tui', args: 'fullscreen' })` would relaunch the session. Not tried, and not something a Mod should do unasked.

## Sources

- Live runs: `claude` 2.1.310, `--plugin-dir research/probes/main-screen-scroll`, `--model haiku`, 140×40 pty. The env cases are tabulated above. Logs: the probe's `log.jsonl` and `--debug-file` (`ui.scroll … : unscrollable|revealed`).
- Engine `~/.local/share/claude/versions/2.1.310`: `Twt` / `uD` / `nv` (scroll transcript path and person check); scroll-pin `reveal`; `ReplSessionScope` `transcript.reveal`; `lxt` (REPL layout: `Zl()` ScrollBox, `WW()` → `Gi` ScrollBox, else fragment); `Zl` / `nU` / `m2e` (renderer choice); `WW` (`decstbmRendererEnabled`); `_i` (`renderMode === "fullscreen"`); `HXe` (`command.run` presentation); terminal render-input `viewport` stamping.
- `claude-code.d.ts` (plugin-authoring 2.1.302): `CommandPresentation` ~1784; `$.ui.open` ~2512; `$.ui.scroll` ~2562; `$.settings` ~3645; `RenderViewport` ~10805; `UiScrollResult` ~15100.
- `reference.md` (same folder): Button `hotkey` and focused pane.
- [Fullscreen rendering](https://code.claude.com/docs/en/fullscreen), code.claude.com docs.
