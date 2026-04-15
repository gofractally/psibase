# WASM plugin memory (plan)

> **History, measurements, and archived investigation:** [wasm-plugin-memory-history.md](wasm-plugin-memory-history.md)

This file is the **non-history** companion: current direction, iterations, and operational plan. If your checkout is missing the long-form narrative that lived here before, merge or cherry-pick from the branch where those commits landed (this clone had no `git` history for these paths on `mm/wasm-composition`).

---

## Canonical paths (repo root)

| Document | Path |
|----------|------|
| History / findings / raw measurements | `wasm-plugin-memory-history.md` |
| Plan (current approach, iterations) | `wasm-plugin-memory-plan.md` (this file) |

---

## Current approach (summary)

Lazy instantiation plus bounded instance pool and eviction; see history for VAS rationale, composition findings, and stress-test numbers.

## Browser variance (QA)

Chromium (Brave) reproduces WASM instantiation failures much more readily than Firefox under the same psibase flows (Config + other apps). Treat Chromium-class browsers as the **stress case** for memory work; see [history: Real app usage](wasm-plugin-memory-history.md#real-app-brave-vs-firefox).
