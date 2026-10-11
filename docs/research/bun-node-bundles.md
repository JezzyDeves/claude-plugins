# Can Bun produce Node-runnable bundles for hooks and MCP servers?

Research for [#3](https://github.com/JezzyDeves/claude-plugins/issues/3), part of map [#1](https://github.com/JezzyDeves/claude-plugins/issues/1) (TypeScript conventions for the marketplace).

Constraints this answers against: installed plugins are copied to a cache with no build or install step; installers have Node only; Bun is the dev-side toolchain.

Researched 2026-10-11. Empirical checks used **Bun 1.4.2** and **Node 22.23.2** on macOS (Darwin 25.6). The latest Bun is 1.4.3 (published 2026-10-10).

## Answer

**Yes.** `bun build <entry>.ts --target=node --outfile=dist/<name>.mjs` produces one self-contained ESM file that plain Node runs. Every npm dependency is inlined, `node:` builtins stay as imports, and a `#!/usr/bin/env node` shebang on the entry is kept. Stdio MCP servers built on the v1 SDK (`@modelcontextprotocol/sdk`) and on the v2 SDK (`@modelcontextprotocol/server`) both bundled and completed an `initialize` → `tools/list` → `tools/call` round trip under Node.

Two things are required:

1. **`--target=node` is mandatory.** The default target is `browser`. With it, the v2 SDK resolves its browser shim, and `StdioServerTransport` throws at startup under Node. See [Gotchas](#gotchas).
2. **Commit the bundle.** Installers get no build step, so `dist/*.mjs` must be checked in, and hooks and `.mcp.json` must point at `${CLAUDE_PLUGIN_ROOT}/dist/<name>.mjs`.

## 1. `bun build --target=node` output

| Question | Finding | Source |
|---|---|---|
| Single self-contained file? | Yes. `packages` defaults to `bundle`, so all bare imports are inlined unless `--packages external` or `--external` is passed. One entry with `--outfile` gives one file, and splitting is off by default. | [Bundler docs](https://bun.com/docs/bundler); empirical |
| What `--target=node` does | It "prioritizes the `"node"` export condition". "Bun does not polyfill the `Bun` global or the built-in `bun:*` modules." | [Bundler docs](https://bun.com/docs/bundler) |
| ESM vs CJS | ESM is the default. `--format=cjs` and `iife` are documented as **experimental**. CJS cannot hold a top-level `await`: building the MCP server with `--format=cjs` failed with `"await" can only be used inside an "async" function`. | [Bundler docs](https://bun.com/docs/bundler); empirical |
| Shebang | The entry's `#!/usr/bin/env node` was kept as line 1 of the output. The docs don't state this, but they say a `#!/usr/bin/env bun` shebang changes the default target to `bun`, so never use that one. `--banner` exists for injecting a header if needed. | Empirical; [Bundler docs](https://bun.com/docs/bundler) |
| `node:` builtins | Left as external `import … from "node:path"` statements and not bundled. | Empirical (grep of output) |
| `import.meta.dirname` | Preserved. At runtime it resolves to the bundle's own directory (the probe returned `out` and `v2min`), so reading files next to the bundle works from the plugin cache. It requires Node ≥ 20.11. | Empirical |
| Sourcemaps | `none` (default), `linked` (needs `--outdir`), `external`, `inline`. Node uses them only with `node --enable-source-maps`. | [Bundler docs](https://bun.com/docs/bundler) |
| `.mjs` vs `.js` | An ESM bundle named `.js` with no `"type":"module"` package.json also ran on Node 22.23, because Node detects module syntax. `.mjs` is unambiguous on every Node version and needs no package.json in the cache, so prefer it. Use `--outfile x.mjs`, or `--outdir` with `'--entry-naming=[name].mjs'` (quote it in zsh). | Empirical |
| `--compile` | Not applicable. It embeds a copy of the Bun binary into a platform-specific executable, which is the opposite of "Node only". | [Bundler docs](https://bun.com/docs/bundler) |

## 2. Bundling the MCP TypeScript SDK (stdio server)

There are two SDK lines on npm (2026-10-11):

| Package | Version | Node engines | Module | Notes |
|---|---|---|---|---|
| `@modelcontextprotocol/server` (v2) | 2.3.1 | `>=20` | ESM + CJS dual | The SDK repo's `main` is "v2 of the SDK", the stable line, implementing the 2026-07-28 spec. Depends only on `@modelcontextprotocol/core` and `zod ^4.2`. Schemas are Standard Schema (Zod v4, Valibot, ArkType). |
| `@modelcontextprotocol/sdk` (v1) | 1.32.1 | `>=18` | ESM + CJS dual | Lives on the `v1.x` branch. It has a large dependency tree (express, hono, ajv, cors, jose…), but tree-shaking removes most of it for a stdio-only server. |

Sources: [typescript-sdk README](https://github.com/modelcontextprotocol/typescript-sdk), `npm view @modelcontextprotocol/server` / `npm view @modelcontextprotocol/sdk`.

Empirical results for a one-tool (`echo`) stdio server, run under `node --enable-source-maps` from a directory with **no** `node_modules`:

| Build | Size | Under Node |
|---|---|---|
| v2, `--target=node` | 759 KB (107 modules) | initialize / tools/list / tools/call OK |
| v2, `--target=node --minify --sourcemap=linked` | 400 KB (106 KB gzip) + 1.68 MB `.map` | OK |
| v1, `--target=node` | 748 KB (243 modules) | OK |
| v2, default target (browser) | 540 KB | **Crashes:** `StdioServerTransport is not supported in this environment` |

Most of the size is Zod plus the SDK's protocol schemas. Expect roughly 400 KB minified per MCP server bundle.

## 3. Workspaces, `bun test`, and type checking

**Workspaces.** The root `package.json` declares `"workspaces": ["packages/*", "plugins/*"]` (globs and `!` negations allowed). Siblings are referenced with `"workspace:*"`. `bun install --filter` and `bun --filter '<pattern>' <script>` scope work to some workspaces, and a root `catalog:` can pin shared dependency versions once. ([Workspaces docs](https://bun.com/docs/install/workspaces))

New workspace projects default to the **isolated linker** (Bun ≥ 1.3.2, lockfile `configVersion = 1`). Packages live in `node_modules/.bun/`, and each workspace's `node_modules` holds symlinks to only its declared dependencies. You can switch with `bun install --linker hoisted` or `bunfig.toml` `[install] linker`. ([Isolated installs docs](https://bun.com/docs/install/isolated)) Empirically, `plugins/demo/node_modules/@internal/shared` was a symlink to `../../../../packages/shared`.

**Shared internal packages need no build step of their own.** An internal package can export raw TS (`"exports": { ".": "./src/index.ts" }`). When a plugin's entry imports it, `bun build` inlines it. Empirically, a hook importing `@internal/shared` (`workspace:*`) bundled to a 259-byte `.mjs` with the shared code inlined, and it ran correctly under Node on a stdin JSON payload. The plugin's committed bundle has no runtime dependency on the workspace.

**`bun test`.** It finds `*.test|*_test|*.spec|*_spec` files (`.ts/.tsx/.js/.jsx/...`) recursively from the working directory. It is Jest-compatible but not complete. **Tests run in the Bun runtime, not Node**, so a passing `bun test` does not prove Node compatibility. It "runs TypeScript tests without checking their types." ([Test docs](https://bun.com/docs/test))

**Type checking.** Bun never type-checks when it runs, tests, or builds. ([TypeScript docs](https://bun.com/docs/typescript)) There are two options:

- **`tsc --noEmit`**: stable and works on any Bun version. Bun's recommended tsconfig is `"module": "Preserve"`, `"moduleResolution": "bundler"`, `"allowImportingTsExtensions": true`, `"verbatimModuleSyntax": true`, `"noEmit": true`, `"types": ["bun"]` (with `@types/bun`). For plugin code that must run on Node, `@types/node` is a better fit than `@types/bun`, because it makes the compiler reject `Bun.*` APIs, which the node target won't polyfill.
- **`bun check`**: new in **Bun 1.4.3** (2026-10-10). It is a native checker that "reports the same errors as `tsc` from TypeScript 7" and needs no `typescript` package. It supports `-p <project>` and `-b` for project references, and the same release added `bun test --check` and `bun build --check`, which type-check before running or building. ([`bun check` docs](https://bun.com/docs/runtime/check), [Bun v1.4.3 release notes](https://bun.com/blog/bun-v1.4.3)) It is not in Bun 1.4.2: locally, `bun check` → `Script not found "check"`. It is very new, so adopting it means pinning Bun ≥ 1.4.3 in CI.

A pipeline that fits these findings: `bun install` → type-check (`tsc --noEmit` or `bun check`) → `bun test` → `bun build --target=node` per entry → **smoke-run each bundle under `node`** (the only step that proves Node compatibility) → commit `dist/`.

## Gotchas

1. **Forgetting `--target=node` breaks MCP servers silently at build time and loudly at run time.** `@modelcontextprotocol/server` routes `./_shims` through `node` / `browser` / `workerd` export conditions. The default `browser` target picks `shimsBrowser`, and `new StdioServerTransport()` then throws under Node. It builds without a warning. (Empirical; `npm view @modelcontextprotocol/server exports`.)
2. **No `Bun.*` or `bun:*` at runtime.** `--target=node` does not polyfill them ([Bundler docs](https://bun.com/docs/bundler)). Plugin runtime code must use only Node APIs. Bun APIs are fine in build scripts and tests.
3. **Never `--packages external`.** The cache has no `node_modules`, so every dependency must be inlined.
4. **`bun test` passing ≠ runs on Node.** Tests run on Bun. Add a Node smoke test of the built bundle (e.g. pipe a JSON payload into a hook, or do an MCP `initialize` round trip).
5. **Unminified bundles embed absolute dev-machine paths** in `// <path>` module comments (30 in the v2 probe). That causes noisy diffs between machines and leaks local paths into a public repo. `--minify` (or `--minify-whitespace`) strips them.
6. **Top-level `await` forces ESM.** `--format=cjs` (experimental anyway) rejects it.
7. **Node floor.** v2 SDK `engines` is `node >=20`, and `import.meta.dirname` needs Node ≥ 20.11. v1 SDK allows `>=18`.
8. **Shebang choice.** Write `#!/usr/bin/env node` in sources. `#!/usr/bin/env bun` changes the default target to `bun`, whose CJS wrapper "is not compatible with Node.js". Plugin configs should invoke `node ${CLAUDE_PLUGIN_ROOT}/dist/x.mjs` explicitly anyway, so neither the shebang nor the exec bit matters.
9. **Linked sourcemaps are large** (1.68 MB for a 400 KB bundle) and only help when Node runs with `--enable-source-maps`. Weigh committing them against the readable stack traces they give.

## Sources

- Bun bundler: https://bun.com/docs/bundler
- Bun workspaces: https://bun.com/docs/install/workspaces
- Bun isolated installs: https://bun.com/docs/install/isolated
- Bun test runner: https://bun.com/docs/test
- Bun TypeScript: https://bun.com/docs/typescript
- `bun check`: https://bun.com/docs/runtime/check
- Bun v1.4.3 release notes: https://bun.com/blog/bun-v1.4.3
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- npm registry metadata: `@modelcontextprotocol/server@2.3.1`, `@modelcontextprotocol/sdk@1.32.1`, `bun@1.4.3`
- Empirical probes (scratch only, not in repo): Bun 1.4.2, Node 22.23.2, macOS
