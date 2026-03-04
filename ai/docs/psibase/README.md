# Psibase Knowledge Base (AI-Focused)

> **Status**: Phase 2 complete. The documents below are available for AI and human reference.

This directory contains AI-focused documentation about psibase app development, covering:

- **Architecture overview**: How services, plugins, UIs, and query services relate
- **Rust service development**: Tables, actions, events, fracpack, account numbers
- **Plugin development**: WASM components, WIT interfaces, Supervisor integration
- **UI development**: React/TypeScript apps, Supervisor API, plugin communication
- **Build system**: CMake/make commands, package configuration, adding new apps
- **Testing**: Service tests, integration tests, deploy verification
- **Gotchas and pitfalls**: Common mistakes, psibase-specific quirks, WASM component gotchas
- **When to ask the user**: Situations where AI should escalate rather than guess

All documentation references the official psibase docs at `doc/src/` and uses examples from the codebase (primarily `packages/user/`).

## Documents

| Document | Description |
|----------|-------------|
| [architecture.md](architecture.md) | Full-stack architecture overview with diagrams |
| [rust-services.md](rust-services.md) | Writing Rust services (tables, actions, events, queries) |
| [plugins.md](plugins.md) | Plugin development (WIT, WASM components, Supervisor) |
| [ui-development.md](ui-development.md) | UI patterns (React, Supervisor API, plugin calls) |
| [build-system.md](build-system.md) | CMake/make build system, adding packages |
| [testing.md](testing.md) | Available testing infrastructure and patterns |
| [gotchas.md](gotchas.md) | Psibase-specific pitfalls and when to escalate |
| [quick-reference.md](quick-reference.md) | Cheat sheet for common operations |
