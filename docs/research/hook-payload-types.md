# Published TypeScript types for Claude Code hook payloads

Research for [issue #4](https://github.com/JezzyDeves/claude-plugins/issues/4), part of map [issue #1](https://github.com/JezzyDeves/claude-plugins/issues/1) (TypeScript conventions for the marketplace). Researched 2026-10-11 against `@anthropic-ai/claude-agent-sdk@0.3.296`, which bundles Claude Code 2.1.296.

## Answer

Yes. Anthropic publishes hook input and output types in **`@anthropic-ai/claude-agent-sdk`**, which is the only official package that has them. They are written for SDK callback hooks, not for command hooks. Anthropic's docs say the output format is the same as command-hook stdout JSON. The input types match the documented stdin fields closely but not exactly: one documented common field is missing, and some fields are typed as `unknown`. The package is closed-source and proprietary, it pulls in about 35 MB of peer dependencies, and it publishes a new version almost every day. For plugin hook scripts it can work as a dev-only type dependency, but it is not a clean types-only package.

## Where the types live

| Package | Hook types? | Notes |
| --- | --- | --- |
| `@anthropic-ai/claude-agent-sdk` | **Yes** | `types: sdk.d.ts`; subpath `./sdk-tools` holds the tool input/output types ([npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), [repo](https://github.com/anthropics/claude-agent-sdk-typescript)) |
| `@anthropic-ai/claude-code` (the CLI) | No | No `types` entry. The package is a 189 KB launcher plus a native binary for each platform, installed as an optional dependency |
| MCP (`@modelcontextprotocol/sdk`) | No | MCP has no concept of Claude Code hooks |
| Claude Code hooks docs | No machine-readable schema | The [hooks reference](https://code.claude.com/docs/en/hooks) gives payloads as prose and JSON examples only. It publishes no JSON Schema and no TypeScript types |

## Exported type names (from `sdk.d.ts` in 0.3.296)

**Event list**
- `HookEvent`: union of 33 event-name string literals
- `HOOK_EVENTS`: a readonly tuple const holding the same 33 names

The 33 names match the event list in the [hooks reference](https://code.claude.com/docs/en/hooks).

**Inputs**
- `BaseHookInput`: the shared fields `session_id`, `transcript_path`, `cwd`, `prompt_id?`, `permission_mode?`, `agent_id?`, `agent_type?` and `effort?`
- `HookInput`: a discriminated union of every per-event input, keyed on `hook_event_name`
- One `<Event>HookInput` type per event, for example:
  - `PreToolUseHookInput`, `PostToolUseHookInput`, `PostToolUseFailureHookInput`, `PostToolBatchHookInput`
  - `UserPromptSubmitHookInput`, `UserPromptExpansionHookInput`
  - `SessionStartHookInput`, `SessionEndHookInput`, `StopHookInput`, `StopFailureHookInput`
  - `SubagentStartHookInput`, `SubagentStopHookInput`, `NotificationHookInput`
  - `PermissionRequestHookInput`, `PermissionDeniedHookInput`
  - `PreCompactHookInput`, `PostCompactHookInput`
  - `ConfigChangeHookInput`, `CwdChangedHookInput`, `FileChangedHookInput`
  - …and the rest of the 33

**Outputs**
- `HookJSONOutput`: equal to `AsyncHookJSONOutput | SyncHookJSONOutput`
- `SyncHookJSONOutput`: the top-level fields `continue?`, `suppressOutput?`, `stopReason?`, `decision?: 'approve' | 'block'`, `systemMessage?`, `terminalSequence?`, `reason?` and `hookSpecificOutput?`
- `AsyncHookJSONOutput`: `{ async: true; asyncTimeout?: number }`
- One `<Event>HookSpecificOutput` type per event that has one, for example `PreToolUseHookSpecificOutput`, `PostToolUseHookSpecificOutput`, `UserPromptSubmitHookSpecificOutput`, `SessionStartHookSpecificOutput`, `PermissionRequestHookSpecificOutput` and `StopHookSpecificOutput`
- `HookPermissionDecision`: equal to `'allow' | 'deny' | 'ask' | 'defer'`

**SDK-only (not useful for command hooks)**
- `HookCallback`
- `HookCallbackMatcher`
- `SDKHookStartedMessage`, `SDKHookProgressMessage` and `SDKHookResponseMessage`

**Tool inputs** (`@anthropic-ai/claude-agent-sdk/sdk-tools`)
- A self-contained file with no imports, generated from JSON Schema
- Exports `ToolInputSchemas`, `ToolOutputSchemas`, and per-tool types such as `BashInput`, `FileEditInput`, `FileWriteInput`, `FileReadInput`, `GrepInput`, `GlobInput`, `WebFetchInput` and `AgentInput`
- Use these to narrow `tool_input`, which the hook input types declare as `unknown`

## Do they match CLI hook stdin/stdout one-to-one?

**Output: yes, by Anthropic's own statement.** The [Agent SDK hooks guide](https://code.claude.com/docs/en/agent-sdk/hooks#outputs) says: *"SDK callback hooks use the same JSON output format as Claude Code shell command hooks."* I checked the fields for PreToolUse, PostToolUse, UserPromptSubmit, Stop, PermissionRequest and Notification against the [hooks reference](https://code.claude.com/docs/en/hooks) and they match.

There are two small differences:

- **`decision` values.** `SyncHookJSONOutput.decision` is typed `'approve' | 'block'`. The hooks reference says only `"block"` is valid at top level, and that `approve`/`block` on PreToolUse are deprecated aliases for `allow`/`deny`. The type is therefore looser than the documented contract.
- **`async` output.** `async: true` is the SDK's async return shape. Command hooks configure async behaviour differently, in settings, and the docs do not show `{"async": true}` as command-hook stdout.

**Input: close, but not exact.** These differences turned up while reading:

| Field / aspect | CLI stdin (hooks reference) | SDK type |
| --- | --- | --- |
| `scratchpad_dir` (common field) | Documented ("absent when there is no scratchpad") | **Missing** from `BaseHookInput` |
| `hook_event_name` | Common field | Present on each per-event type as a literal discriminant (fine) |
| `tool_input`, `tool_response` | Shape depends on the tool | Typed `unknown`; narrow with `sdk-tools` types |
| `permission_mode` | Documented enum: `default`, `plan`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions` | Typed `string` |
| PreToolUse, PostToolUse, UserPromptSubmit, Stop, Notification, PermissionRequest, SessionStart event fields | — | Match the documented fields (`tool_use_id`, `duration_ms?`, `mcp_server?`, `stop_hook_active`, `last_assistant_message?`, `background_tasks?`, `session_crons?`, `notification_type`, `permission_suggestions?`, `source`, `model?`, `session_title?` and so on) |

There are also behaviours that a type cannot express:

- exit code 2 meaning "block"
- stderr being fed back to Claude
- the `CLAUDE_ENV_FILE` environment variable
- `${CLAUDE_PLUGIN_ROOT}`

These live only in the [hooks reference](https://code.claude.com/docs/en/hooks).

## Cost of depending on it for types only

Measured with `npm install -D --omit=optional @anthropic-ai/claude-agent-sdk@0.3.296` (npm 7+ auto-installs peers):

- **The package itself** is 5.3 MB unpacked: 19 files, including bundled JS of about 1.2 MB each.
- **Peer dependencies**: `@anthropic-ai/sdk` (≥0.93.0), `@modelcontextprotocol/sdk` (^1.29.0) and `zod` (^4). npm installs them automatically, adding about 34 MB and roughly 100 packages in total. `sdk.d.ts` imports types from all three, and from Node's `stream` and `crypto`.
- **Optional dependencies**: one native Claude Code binary per platform, around **240–257 MB each** (for example `@anthropic-ai/claude-agent-sdk-darwin-arm64` is 240 MB unpacked).
  - A normal install pulls the one for the current platform.
  - Install with `--omit=optional` (or the equivalent in your package manager) to skip it. The SDK only needs it at runtime, and type-only imports never touch it ([TS SDK reference: native binary note](https://code.claude.com/docs/en/agent-sdk/typescript)).
- **Type-check result**: a sample command hook using `import type { HookInput, PreToolUseHookInput, SyncHookJSONOutput }` and `import type { BashInput } from "@anthropic-ai/claude-agent-sdk/sdk-tools"` type-checks cleanly with `tsc --strict`, without `skipLibCheck`, once the peers are installed. Because `import type` is erased, nothing ships at runtime.
- **Update cadence**: 320 versions since 2025-09-27, released almost every weekday (0.3.283 → 0.3.296 between 2026-09-25 and 2026-10-09). The SDK version tracks the bundled CLI version (0.3.N ↔ Claude Code 2.1.N), so a pinned SDK version tells you which CLI the types describe.
- **License**: `SEE LICENSE IN README.md`, which reads: *"© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements…"*. This is proprietary, not open source. Depending on the package is fine, but **copying or vendoring `sdk.d.ts` into this repo is not**. Hand-written types must be written from the public docs, not copied from the package.

## Implications for the decision

There are two reasonable starting points:

1. **Depend on `@anthropic-ai/claude-agent-sdk` as a devDependency.**
   - Use `import type` only, and install with optional dependencies omitted.
   - Benefits: types stay current and cover all 33 events.
   - Costs: about 40 MB in `node_modules` from the package and its peers, daily version churn, and the gaps listed above, which you would patch with a small local extension type (for example `scratchpad_dir`).
2. **Maintain a small hand-written module** covering only the events this marketplace's plugins use.
   - Write it from the [hooks reference](https://code.claude.com/docs/en/hooks), which is the authoritative contract for command hooks.
   - Benefits: zero dependencies and an exact match to the CLI contract.
   - Costs: it can drift from the CLI unless someone reviews it on each Claude Code release.

Either way, the hooks reference stays the source of truth for command-hook behaviour. The SDK types describe the SDK callback interface, which Anthropic documents as sharing the output format with command hooks.

## Sources

- Claude Code hooks reference: https://code.claude.com/docs/en/hooks
- Agent SDK hooks guide (states that SDK and command hooks share the output format): https://code.claude.com/docs/en/agent-sdk/hooks
- Agent SDK TypeScript reference (hook types, native binary optional deps): https://code.claude.com/docs/en/agent-sdk/typescript
- npm package: https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk (inspected tarball `0.3.296`: `package.json`, `sdk.d.ts`, `sdk-tools.d.ts`, `LICENSE.md`)
- Source repo: https://github.com/anthropics/claude-agent-sdk-typescript
- npm package `@anthropic-ai/claude-code` 2.1.296 (no `types` entry): https://www.npmjs.com/package/@anthropic-ai/claude-code
