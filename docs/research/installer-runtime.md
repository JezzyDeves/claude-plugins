# What runtime can plugin code rely on at an installer's machine?

Research for [#2](https://github.com/JezzyDeves/claude-plugins/issues/2), part of map [#1](https://github.com/JezzyDeves/claude-plugins/issues/1) (TypeScript conventions). Sources are the official Claude Code docs (code.claude.com) and the Node.js docs, read 2026-10-11. Doc text quoted verbatim where the wording matters.

## Answer

**Claude Code guarantees no JavaScript runtime.** No install method, including npm, leaves a `node` that Claude Code itself provides or uses. Hook commands and stdio MCP servers run whatever is on the user's `PATH`, so a plugin that runs `node …` works only when the installer has Node installed. No plugin field can declare or enforce a Node version. Committed build output, plus a Node prerequisite documented in the README, is the only contract available. Type stripping (`node file.ts`) is only safe on Node ≥ 22.18 / ≥ 23.6, which we can't verify on the installer's machine. That points to shipping compiled `.js` built with Bun on the dev side.

## 1. Is Node present for every installer?

No.

- **Native installer:** system requirements list OS, hardware, network, shell and ripgrep. Node isn't among them. ([setup § System requirements](https://code.claude.com/docs/en/setup#system-requirements))
- **npm install also ends up with no Node at runtime:** "The npm package requires Node.js 22 or later. On an older Node.js version, npm prints an `EBADENGINE` warning during install rather than failing; the install completes and `claude` still runs, since the package downloads a native binary that doesn't use your Node.js at runtime." And: "The npm package installs the same native binary as the standalone installer … The installed `claude` binary does not itself invoke Node." ([setup § Install with npm](https://code.claude.com/docs/en/setup#install-with-npm))
  - So even npm users may have Node < 22, because the engine check only warns.
- **Homebrew, WinGet, apt/dnf/apk** install the same native binary, and none of them list Node as a dependency. ([setup](https://code.claude.com/docs/en/setup#install-claude-code))
- **Missing `node` is a documented failure mode:** "`Stop hook error: Failed with non-blocking status code: /bin/sh: node: command not found` means the shell Claude Code spawned couldn't find `node`. Install it, or make sure it's on the `PATH` of the terminal you start `claude` from." ([plugins troubleshooting § hook error notices](https://code.claude.com/docs/en/plugins/troubleshooting))
- **The docs' examples still assume `node`:** the canonical plugin MCP example is `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/server.js"]` ([components § MCP servers](https://code.claude.com/docs/en/plugins/components)), and the hooks docs call `node` + script path "the pattern [that] works on every platform" for exec form ([hooks § exec form](https://code.claude.com/docs/en/hooks#exec-form-and-shell-form)). Node is the expected runtime by convention, but the docs never guarantee it.
- **No bundled Node in the Claude Code CLI:** the "bundled Node.js runtime" for MCPB is a Claude Desktop feature ("Included with Claude Desktop on macOS and Windows"). ([claude.com MCPB docs](https://claude.com/docs/connectors/building/mcpb)) Nothing in the Claude Code docs says the CLI ships one. The MCP and plugin docs don't mention a runtime for `.mcpb` bundles in Claude Code. A bundle's own manifest can declare a Node server, but the CLI has no documented runtime to run it with, so we shouldn't rely on `.mcpb` to supply Node.

### Minimum version

Claude Code imposes none on plugins, because Node isn't required at all. The only Node version in the docs is the npm package's `engines` (22+), which is only a warning (see above).

Node type stripping ([nodejs.org/api/typescript](https://nodejs.org/api/typescript.html)):

| Version | Change |
| - | - |
| v22.6.0 | Type stripping added (behind a flag) |
| v23.6.0, v22.18.0 | Enabled by default |
| v24.3.0, v22.18.0 | No experimental warning |
| v25.2.0, v24.12.0 | Stable |

Caveats that matter for us:

- "Node.js refuses to handle TypeScript files inside folders under a `node_modules` path."
- Enums, runtime namespaces, parameter properties, import aliases and decorators aren't supported (they need `--experimental-transform-types`, which was removed in v26).
- Imports must use the `.ts` extension.

The plugin cache path (`~/.claude/plugins/cache/...`) isn't under `node_modules`, so plain stripping would work there. It still requires the installer to have Node ≥ 22.18, and nothing checks that.

## 2. What is copied into the cache, and does any install/build step run?

### Where plugins live

- Marketplace plugins are copied into `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`, and `${CLAUDE_PLUGIN_ROOT}` points there. ([loading § Find plugins on disk](https://code.claude.com/docs/en/plugins/loading#find-plugins-on-disk))
- "Files outside the plugin directory aren't copied." ([loading § In-place and copied plugins](https://code.claude.com/docs/en/plugins/loading#in-place-and-copied-plugins))
- Exceptions that load in place without being copied: `--plugin-dir`, skills-directory plugins, and relative-path plugins from a marketplace added from a **local path**. That last case is what `claude plugin marketplace add ./` does for us during development. ([same section](https://code.claude.com/docs/en/plugins/loading#in-place-and-copied-plugins))

### What the copy contains

- For a GitHub-hosted marketplace, Claude Code clones the repository: "Claude Code clones that marketplace or plugin repository onto their machine. The clone never downloads LFS content." ([host-marketplace § Git LFS](https://code.claude.com/docs/en/plugins/host-marketplace#keep-plugin-files-out-of-git-lfs))
- So the copy holds **only what is committed**. Gitignored build output (`dist/`) or `node_modules/` won't reach installers. This is an inference from "clones" and isn't stated as a rule.
- Symlinks: links inside the plugin are kept, links elsewhere in the marketplace are dereferenced (copied), and links outside the marketplace are skipped. ([host-marketplace § symlinks](https://code.claude.com/docs/en/plugins/host-marketplace#share-files-within-a-marketplace-with-symlinks))
- Every version gets its own directory. Old ones are removed 14 days after an update. Durable state belongs in `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/<id>/`, kept across updates). ([loading](https://code.claude.com/docs/en/plugins/loading#cleanup-of-previous-versions), [manifest reference § Environment variables](https://code.claude.com/docs/en/plugins/manifest-reference#environment-variables))

### No build step runs

- No `build` or `prepare` script runs at install.
- The `npm` source runs no install scripts: "The package's install scripts, such as `preinstall` or `postinstall`, never run." ([marketplace reference § npm](https://code.claude.com/docs/en/plugins/marketplace-reference#npm-plugin-source))
- The only code-producing hook is the `command` source, which runs a command on the user's machine that the user must accept. That doesn't fit a public marketplace. ([marketplace reference § command](https://code.claude.com/docs/en/plugins/marketplace-reference#command-plugin-source))

### Dependencies are installed automatically, with limits

"When Claude Code copies a plugin into the cache, it also installs the plugin's Node.js package dependencies there." ([loading § Node.js package dependencies](https://code.claude.com/docs/en/plugins/loading#node-js-package-dependencies))

It runs only when the plugin root has a `package.json` and a supported lockfile:

- `bun.lock` (text, lockfileVersion ≤ 2) → **Bun**
- `npm-shrinkwrap.json` / `package-lock.json` (v2/3) → **npm**
- Skipped for `bun.lockb`, `yarn.lock` and `pnpm-lock.yaml`.

Limits:

- "Claude Code runs the matched lockfile's package manager from the user's PATH and doesn't try the other lockfile instead if that package manager is missing." A `bun.lock` therefore needs Bun installed on the user's machine. "Include an npm lockfile to reach the most users."
- Registry packages pinned to exact versions only, `https` downloads only, frozen resolution, **`--ignore-scripts`** (native modules won't compile), no npm `overrides` or Bun `patchedDependencies`, and a **60-second timeout**. It can't be turned off.
- On failure "the plugin still loads, but the parts of it that need the missing packages may not work", and `/plugin` shows "The packages it lists are not installed" or "were not installed, because …". ([troubleshooting](https://code.claude.com/docs/en/plugins/troubleshooting))
- It doesn't run for plugins loaded in place, which includes our local-path dev marketplace. It also doesn't run for `command` sources in link mode.
- Fallback: a `SessionStart` hook that runs `npm install` into `${CLAUDE_PLUGIN_DATA}` (example in [components § Reference plugin paths and store data](https://code.claude.com/docs/en/plugins/components#path-variables-and-persistent-data)). That too needs npm on the user's machine.

### `node_modules` inside the plugin directory

- The docs don't say whether a **committed** `node_modules/` is excluded. Clone semantics suggest it would be preserved.
- The auto-install "moves the resulting `node_modules` into the plugin" after a successful install.
- Link-mode `command` plugins must "Include `node_modules`" themselves.
- Bundling to a single self-contained `.js` file avoids the question entirely, because then there are no runtime dependencies to install.

## 3. How hooks and MCP servers are spawned

### Hook `command`s ([hooks](https://code.claude.com/docs/en/hooks#exec-form-and-shell-form))

- **Exec form** (`args` present): `command` is resolved on `PATH` and spawned directly, with no shell and no quoting issues.
  - On Windows, exec form needs a real executable. `.cmd`/`.bat` shims (npm, npx, `node_modules/.bin`) can't be spawned that way. The docs recommend `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/…/script.js"]`.
- **Shell form** (no `args`): `sh -c` on macOS/Linux, Git Bash on Windows, or PowerShell when Git Bash isn't installed. The `shell` field (`"bash"` | `"powershell"`) overrides this. Quote `"${CLAUDE_PLUGIN_ROOT}"`.
- **cwd:** "Handlers run in the current directory with Claude Code's environment", meaning the session's directory, not the plugin root.
- **Environment:** the hook inherits the parent environment (minus `OTEL_*`, and minus scrubbed variables if `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`). Claude Code adds `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_PROJECT_DIR` and `CLAUDE_PLUGIN_OPTION_<KEY>`. ([manifest reference § Where each variable resolves](https://code.claude.com/docs/en/plugins/manifest-reference#where-each-variable-resolves))
- **I/O and timeouts:** input arrives as JSON on stdin. The default timeout is 600 s for `command` hooks, 30 s on `UserPromptSubmit`, and SessionEnd hooks share a 1.5 s budget.

### stdio MCP servers ([mcp § Plugin-provided MCP servers](https://code.claude.com/docs/en/mcp), [components § MCP servers](https://code.claude.com/docs/en/plugins/components))

- Declared in `.mcp.json` or `plugin.json` `mcpServers`. `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` / `${CLAUDE_PROJECT_DIR}` are substituted in `command`, `args` and `env`. `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` are exported to the process, and `CLAUDE_PROJECT_DIR` is set "so your server can resolve project-relative paths without depending on the working directory".
- The docs don't state the server's cwd or whether a shell is involved. Write servers so they don't depend on either.

### Can a plugin declare a runtime requirement?

No.

- `plugin.json` has no `engines` or runtime field. Unrecognized top-level keys are stripped, with a `validate` warning. ([manifest reference § Fields](https://code.claude.com/docs/en/plugins/manifest-reference#fields))
- `dependencies` only names **other plugins**. ([dependencies](https://code.claude.com/docs/en/plugins/dependencies))
- A minimum *Claude Code* version can be enforced only by managed settings (`requiredMinimumVersion`), not by a plugin. ([setup § Pin a minimum version](https://code.claude.com/docs/en/setup#pin-a-minimum-version))
- The available ways to cope with a missing `node`:
  - document Node as a prerequisite in the README
  - have a hook check `node --version` and print a clear error
  - write the hook in POSIX `sh`, which every macOS/Linux machine has, but which isn't TypeScript

## Implications for the TypeScript conventions (#1)

1. Treat **Node as a documented prerequisite** for any plugin with runtime code. Claude Code doesn't provide it.
2. **Ship compiled JS, committed to the repo.** No build step runs at install, and a clone includes only committed files. Bun can build it on the dev side (`bun build --target=node`).
3. **Bundle each entry point into one self-contained `.js` file.** This avoids the auto-install's constraints: an npm lockfile, `--ignore-scripts`, the 60 s timeout, no install for in-place dev loads, and needing npm/bun on the user's PATH. If we do keep runtime dependencies, ship `package-lock.json` (not `bun.lock`), because a `bun.lock` triggers an install only when the installer has Bun.
4. **Target an old-enough Node.** Don't rely on type stripping (≥ 22.18), because we can't know the installer's version. If we must pick a floor, a conservative target such as Node 20 is safer than one that assumes 22.18+.
5. **Invoke as `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/x.js"]`** (exec form). This works on every platform, needs no quoting, and avoids Windows `.cmd` shims.
6. Don't depend on cwd. Use `CLAUDE_PLUGIN_ROOT` / `CLAUDE_PROJECT_DIR` / `CLAUDE_PLUGIN_DATA`.
