# Psibase Knowledge Base (AI-Focused)

> **Status**: Phase 2 — This documentation will be written in Phase 2 of the AI coding workflow project.

This directory will contain thorough, AI-focused documentation about psibase app development, covering:

- **Architecture overview**: How services, plugins, UIs, and query services relate
- **Rust service development**: Tables, actions, events, fracpack, account numbers
- **Plugin development**: WASM components, WIT interfaces, Supervisor integration
- **UI development**: React/TypeScript apps, Supervisor API, plugin communication
- **Build system**: CMake/make commands, package configuration, adding new apps
- **Testing**: Service tests, integration tests, deploy verification
- **Gotchas and pitfalls**: Common mistakes, psibase-specific quirks, WASM component gotchas
- **When to ask the user**: Situations where AI should escalate rather than guess

All documentation references the official psibase docs at `doc/src/` and uses examples from the codebase (primarily `packages/user/`).

## Planned Documents

| Document | Description |
|----------|-------------|
| `architecture.md` | Full-stack architecture overview with diagrams |
| `rust-services.md` | Writing Rust services (tables, actions, events, queries) |
| `plugins.md` | Plugin development (WIT, WASM components, Supervisor) |
| `ui-development.md` | UI patterns (React, Supervisor API, plugin calls) |
| `build-system.md` | CMake/make build system, adding packages |
| `testing.md` | Available testing infrastructure and patterns |
| `gotchas.md` | Psibase-specific pitfalls and how to avoid them |
| `quick-reference.md` | Cheat sheet for common operations |
