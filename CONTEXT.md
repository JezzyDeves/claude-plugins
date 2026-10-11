# JezzyDeves Plugins

A public Claude Code plugin marketplace: a catalogue of plugins that anyone can add and install from.

## Language

**Marketplace**:
This repo as a whole, published under the name `jezzydeves-plugins`, listing every plugin it offers.
_Avoid_: Registry, catalog

**Plugin**:
One installable unit in the marketplace, living in its own directory under `plugins/`.
_Avoid_: Extension, package

**Installed plugin**:
The copy of a plugin that Claude Code places in its cache on an installer's machine; it runs from there, separate from this repo.
_Avoid_: Deployed plugin

**Installer**:
Anyone who adds the marketplace and installs a plugin from it; assumed to have Node and nothing else.
_Avoid_: User, consumer

**Plugin runtime code**:
Code that ships inside a plugin and runs on an installer's machine, such as hook commands and MCP servers.
_Avoid_: Plugin source, plugin scripts

**Repo tooling**:
Code that operates on the marketplace itself during development or CI and never ships to installers.
_Avoid_: Dev scripts, build scripts
