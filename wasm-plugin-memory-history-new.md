# WASM plugin memory: history and measurements

Companion plan (non-history): [wasm-plugin-memory-plan.md](wasm-plugin-memory-plan.md).

**Canonical location:** both files live at the **repository root** (`wasm-plugin-memory-history.md`, `wasm-plugin-memory-plan.md`).

**If these files are empty or missing in your branch:** they may only exist on another branch or machine. This document was recreated to preserve new measurements; merge older narrative from your branch if needed.

---

## VAS limit stress test (`tmp/vas-test/vas-limit.html`)

**Purpose:** Instantiate the same minimal WASM module (one exported `memory`, initial size 1 page) repeatedly to observe when the engine refuses new linear memories. Serves as a rough probe of per-process WASM virtual address space pressure.

**Method:**

- Single `WebAssembly.compile()` of a tiny module, then repeated `WebAssembly.instantiate(compiledModule)` every **250 ms** until error or user Stop.
- **Counted (real):** instances created, unique `WebAssembly.Memory` objects (via exports), sum of `buffer.byteLength` (actual committed linear memory).
- **Estimated VAS:** `unique_memories * 10 GB` — **not** read from the OS or browser; it is the usual Chromium/V8 rule-of-thumb for guard regions around 64-bit linear memory. Use `top`/`VIRT` or `/proc/<pid>/maps` if you need OS-level virtual size trends.

**Note (Brave garbled status):** If the UI showed `OOM â€"` instead of `OOM -`, that was UTF-8 for a Unicode en-dash being mis-decoded; `vas-limit.html` now uses ASCII hyphens only.

### Results (manual runs, 2026-04-15)

#### Firefox (stopped by user)

| Metric | Value |
|--------|------:|
| Instances created | 302 |
| Unique `WebAssembly.Memory` objects | 302 |
| Actual committed memory (sum of buffers) | 19,328 KiB (~18.9 MiB) |
| Estimated VAS reserved | ~3020 GB (~2.95 TiB) |
| Stop reason | User clicked Stop (no engine OOM in this run) |

#### Brave (hit engine OOM)

| Metric | Value |
|--------|------:|
| Instances created | 124 |
| Unique `WebAssembly.Memory` objects | 124 |
| Actual committed memory (sum of buffers) | 7,936 KiB (~7.8 MiB) |
| Estimated VAS reserved | ~1240 GB (~1.21 TiB) |
| Stop reason | `WebAssembly.instantiate(): Out of memory: Cannot allocate Wasm memory for new instance` |

**Interpretation:** Firefox allowed far more instances before manual stop than Brave allowed before hard OOM. That is consistent with **different engines / guard layouts / caps** (and possibly different effective WASM VAS budgets), not a contradiction in counting. The **~1.2 TiB** Brave estimate aligns with the often-cited **~1 TiB per-renderer-process** ballpark for Chromium-family WASM VAS. Firefox may use a different mapping strategy or budget.

**Takeaway for psibase:** Peak **concurrent** `WebAssembly.Memory` count matters more than raw instance count if old memories are GC'd; cross-tab and cross-navigation timing still matters on Chromium.

---

<a id="real-app-brave-vs-firefox"></a>

## Real app usage: Brave vs Firefox (confirmed, 2026-04-15)

**Brave (Chromium):** Basic load and login into the **Config** app, followed by nearly **any** interaction with **other** apps in the same flow, is enough to hit the WASM memory / instantiation limit (`Cannot allocate Wasm memory for new instance` class failures). The product feels **fragile** on Chromium-class browsers under normal multi-app use.

**Firefox:** The same pattern (Config load + login, then heavy use of other apps **in the same tab**) does **not** reproduce the error in practice; apps can be used extensively without hitting WASM memory instantiation errors.

**Interpretation:** This matches the synthetic stress-test pattern above: Chromium-family engines hit a hard ceiling at a much lower count of linear memories than Firefox in these experiments. **Primary development and QA for WASM-heavy flows should not assume Brave/Chrome behavior is representative of all browsers**; Firefox may mask VAS pressure that still affects a large share of users.

**Engineering implication:** Mitigations (lazy instantiation, pool/eviction, cross-navigation retry) remain important for Chromium; they also help any engine under pathological load, but the **user-visible severity** is currently browser-dependent.
