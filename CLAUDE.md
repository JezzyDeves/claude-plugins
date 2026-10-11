# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A personal Claude Code plugin marketplace, published on GitHub. Users add it with `/plugin marketplace add JezzyDeves/claude-plugins` and install plugins from it with `/plugin install <plugin>@jezzydeves-plugins`.

The repo is new; the layout below is the convention to follow as plugins are added.

## Layout

```
.claude-plugin/marketplace.json     # marketplace manifest: name, owner, plugins[]
plugins/<plugin-name>/
  .claude-plugin/plugin.json        # plugin manifest: name, version, description, author
  skills/<skill-name>/SKILL.md      # skills (frontmatter: name, description)
  commands/*.md                     # slash commands
  agents/*.md                       # subagents
  hooks/hooks.json                  # hooks
  .mcp.json                         # MCP servers
```

Only `plugin.json` goes inside a plugin's `.claude-plugin/`; component directories sit at the plugin root. Inside hooks and MCP configs, reference plugin files via `${CLAUDE_PLUGIN_ROOT}`, never absolute or repo-relative paths, because installed plugins are copied to a cache directory.

Each plugin needs an entry in `marketplace.json`'s `plugins` array whose `source` points at its directory (e.g. `"./plugins/<plugin-name>"`). Keep the entry's `name`/`version` in sync with the plugin's `plugin.json`.

## Commands

```bash
claude plugin validate .                          # validate marketplace.json
claude plugin validate plugins/<name>             # validate one plugin
claude plugin validate --strict .                 # warnings fail too (use in CI)
claude --plugin-dir plugins/<name>                # try a plugin in a session without installing
claude plugin marketplace add ./                  # add this checkout as a local marketplace
claude plugin install <name>@jezzydeves-plugins   # install from it
claude plugin marketplace update jezzydeves-plugins  # pick up local edits after adding
claude plugin details <name>                      # component inventory and token cost
claude plugin eval plugins/<name>                 # run the plugin's evals/ suite
claude plugin tag plugins/<name>                  # create {name}--v{version} release tag
```

`claude plugin init` scaffolds into `~/.claude/skills/`, not this repo — move the result into `plugins/` or create files directly.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `JezzyDeves/claude-plugins` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
