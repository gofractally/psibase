# Why plugin fetches are synchronous

**Verdict:** Plugin HTTP is synchronous because the *entire* in-plugin call stack is a sync ABI today—from jco-lowered WASM exports through inter-plugin proxies to the Supervisor bridge—not because the browser cannot do async WASM. The bridge implements that ABI with sync `XMLHttpRequest` (and `localStorage` for storage). Enabling `fetch` and overlapping requests means flipping that ABI (component-model / JSPI async imports), not only swapping XHR for `fetch`.

Related planning already lives in [`scratch/plugin-composition-02-v1.md`](scratch/plugin-composition-02-v1.md) (IndexedDB as the forcing function; HTTP as the same wave). [jco PR #2308](https://github.com/bytecodealliance/jco/pull/2308) matters only once we turn on `--async-mode=jspi` for exported resource constructors/statics—we do not use that mode today.

---

## Call chain (where sync begins)

```
App UI (async Promise)
  common-lib Supervisor.functionCall
       │  postMessage → Supervisor iframe
       ▼
Supervisor.entry                    ASYNC (preload, transpile, instantiate)
  start-tx                          SYNC  (supervisorCall)
  this.call(args)                   SYNC  ← sync boundary starts here
    Plugin.call → jco export        SYNC
      … syncCall into other plugins …
      host:http → HttpRequest::send
        supervisor:bridge send-request   WIT sync func
          PluginHost.sendRequest
            XMLHttpRequest.open(..., false)   SYNC XHR
  finish-tx                         SYNC
  replyToParent                     async message back to UI
```

| Layer | Path | Role |
|-------|------|------|
| App client | `packages/user/CommonApi/common/packages/common-lib/src/supervisor.ts` | `functionCall` → iframe `postMessage`; returns a Promise |
| Ingress / queue | `packages/user/Supervisor/ui/src/window-messaging.ts`, `serialize.ts` | All Supervisor message handlers run through a **global async serializer**—one `entry` / preload / getJson at a time |
| Entry | `packages/user/Supervisor/ui/src/supervisor.ts` | `entry` awaits preload/instantiate, then **synchronously** `call`s the plugin between `start-tx` and `finish-tx` |
| Plugin invoke | `packages/user/Supervisor/ui/src/plugin/plugin.ts` | Plain `func(...params)`—no `await` |
| Import proxies | `packages/user/Supervisor/ui/src/component-loading/loader.ts` | `buildInterfaceProxy` / `addResourceProxy` → `host.syncCall` / `syncCallDyn` / `syncCallResource` |
| Bridge JS | `packages/user/Supervisor/ui/src/plugin/plugin-host.ts` | Privileged `host` imports only: `sendRequest` (XHR), `db*` (Web Storage), prompt, crypto helpers |
| HTTP plugin | `packages/user/Host/plugin/http/` | Rust `HttpRequest::send` → `Supervisor::send_request` |
| Bridge WIT | `packages/user/Host/plugin/http/wit/deps/supervisor.wit` | `send-request: func(...) -> result<...>` — not `async func` |

Comment at the sync call site:

```481:483:packages/user/Supervisor/ui/src/supervisor.ts
            // Make a *synchronous* call into the plugin. It can be fully synchronous since everything was
            //   preloaded.
            const result = this.call(args);
```

### Pipeline work for full async / parallel fetches

Rows are app → server → app.

- **Phase 1 (async):** JSPI + `fetch` + async `entry`, **entries stay serial** (global `serialize` kept). UI non-blocking; one in-flight plugin tree; fetches still one-at-a-time inside a call.
- **Phase 2 (full parallelism):** only work that does **not** fall out of Phase 1 — multi-entry overlap and/or in-call overlapping fetches.

NOTE on parllelism: parallism also introduces the spectre of a *few* compositions vying for memory at the same time, which puts us in nearly guaranteed danger of VAS OOM issues.

| Point in the call flow | Phase 1 (async) | Phase 2 (full parallelism) |
|------------------------|-----------------|----------------------------|
| App UI: issue one or many `functionCall`s | ✅ already Promise/`postMessage` | ✅ — (UI can already fire many; Supervisor decides overlap) |
| Supervisor iframe ingress (`addCallHandler`) | ✅ keep global `serialize` (one `entry` at a time) | drop/relax `serialize`; per-entry call stack / origination / prompt rules (**multi-entry**) |
| `entry` + `start-tx` / `call` / `finish-tx` | `await` promising exports; still one open tx | per-entry tx construction (`OpenTx` / ephemeral DB isolation) (**multi-entry**) |
| jco plugin export (`Plugin.call`) | JSPI `asyncExports` / `WebAssembly.promising` | ✅ — (promising already returns a Promise; overlap is an ingress/`entry` problem) |
| Inter-plugin proxies (`syncCall*`) | compose full static plugin set to eliminate inter-plugin JS glue; `Suspending` on bridge (+ any leftover proxies)  ^[compose-vs-async-glue] | reentrancy-safe leftovers or separate instances if multi-entry shares a graph |
| Guest `host:http` / `HttpRequest::send` | ✅ JSPI: keep sync-style Rust (blocks that stack until import resolves) | CM `async func` / WASIp3 so one call can await several fetches (**in-call**) |
| Bridge WIT `send-request` | JSPI async import (WIT can stay `func`) | CM `async func` if WASIp3 guest path (**in-call**) |
| `PluginHost.sendRequest` | sync XHR → `fetch` | ✅ — (`fetch` already concurrent once multiple requests are in flight) |
| Network / server | ✅ — | ✅ — (already concurrent) |
| Response → bridge → resume guest | ✅ JSPI resume of the single suspended stack | CM/WASIp3: complete whichever guest task the response belongs to (**in-call**) |
| `finish-tx` → `replyToParent` → UI Promise | await async `finish-tx`; reply already async | multi-entry: each entry finishes/submits **its** tx, then its own reply |

^[compose-vs-async-glue]: The real choices once the bridge can be async:

1. **Compose** the static set → no JS between plugins; only bridge imports are async JS.
2. **Keep separate instantiates** → every JS hop on a path to async I/O must go Suspending/async (async-`syncCall` across instances).
3. **Keep sync JS glue** → bridge (and anything under it) must stay sync too.

There isn’t a stable “async bridge + sync inter-plugin JS proxies” middle ground without blocking the thread or lying about the ABI.

---

## Constraints that keep us synchronous

These stack; fixing only the leaf (XHR → `fetch`) without the layers above it does not work under today’s codegen.

### 1. WIT bridge is a sync import

```41:45:packages/user/Host/plugin/http/wit/deps/supervisor.wit
interface intf {
    use types.{http-request, http-response, error, plugin-id};

    send-request: func(req: http-request, with-credentials: bool) -> result<http-response, error>;
}
```

The same pattern applies to `supervisor:bridge/database` (`get` / `set` / `remove`). Sync WIT + sync Rust guest code is the contract plugins compile against.

### 2. jco transpile does not enable JSPI / async imports

Supervisor uses `@bytecodealliance/jco` **1.35.0** and generates with:

```232:241:packages/user/Supervisor/ui/src/component-loading/loader.ts
    const opts: GenerateOptions = {
        name,
        noTypescript: true,
        instantiation: { tag: "async" },
        noNodejsCompat: true,
        tlaCompat: false,
        validLiftingOptimization: false,
        noNamespacedExports: true,
        tracing: false,
    };
```

`instantiation: { tag: "async" }` only means the **module instantiate** API is async (load cores, wire imports). It does **not** make WIT functions async.

There is **no** in-tree use of `asyncMode: "jspi"`, `asyncImports`, `asyncExports`, or CLI `--async-mode=jspi`. Grep of the psibase tree finds zero JSPI wiring. Without that, a host import that returns a Promise cannot suspend and resume the WASM stack: the sync lowering expects a concrete return value before WASM continues.

Core WASM itself is not “incapable of async”; the missing piece is **JavaScript Promise Integration (JSPI)** (or an equivalent component-model async lowering) in the transpile + runtime path we actually run.

### 3. Inter-plugin proxies are sync closures

```114:122:packages/user/Supervisor/ui/src/component-loading/loader.ts
            const service = getPluginService(services, intf.namespace);
            proxy[kebabToCamel(func.name)] = (...args: unknown[]) =>
                host.syncCall({
                    service,
                    plugin: intf.package,
                    intf: intf.name,
                    method: func.name,
                    params: args,
                });
```

Resource constructors/methods likewise call `syncCallResource` from a normal JS constructor/method. Any mid-stack `host:http` call must return before the caller WASM continues. Making only the bridge async while leaving cross-instantiate `syncCall` sync is exactly the anti-pattern called out in the composition plan (async-`syncCall` across two composites).

### 4. Sync XHR is the browser API that fits the sync ABI

```125:139:packages/user/Supervisor/ui/src/plugin/plugin-host.ts
    // A synchronous web request.
    // This allows the plugin to make http queries.
    // It is a typescript-ified version of the wasip2 browser http shim
    //    from BytecodeAlliance's JCO project.
    private sendRequest(
        req: HttpRequest,
        withCredentials: boolean = false,
    ): HttpResponse {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open(
                req.method.toString(),
                this.rewriteUriHook(req.uri),
                false,
            );
```

Consequences of sync XHR:

- Blocks the **Supervisor iframe’s** JS thread for the duration of the request (parent UI remains Promise-based via `postMessage`, but that one plugin call cannot overlap other Supervisor work—see below).
- Cannot use `responseType = 'arraybuffer'`; binary responses use `overrideMimeType("text/plain; charset=x-user-defined")` + byte-string decode (documented as deferred cleanup until async HTTP lands).

Only the `host` service gets bridge imports (`privileged` in plugin compile); app plugins reach the network only by importing `host:http`, which bottoms out here.

### 5. Storage chose LocalStorage for the same reason

Spec: [`doc/src/specifications/app-architecture/plugins.md`](doc/src/specifications/app-architecture/plugins.md) — LocalStorage “because it is a synchronous interface which is easiest to integrate with wasm”; IndexedDB is the planned future backing. IndexedDB has **no** sync API, so the same ABI problem blocks storage upgrades. Composition notes treat IndexedDB as the **forcing function** for async Supervisor JS I/O; HTTP `fetch` is the same wave (optional to land together or slightly later if mixed sync/async imports are acceptable).

### 6. Transaction / prompt control flow assumes one contiguous sync stack

`entry` does `start-tx` → sync plugin tree → `finish-tx`. Prompts unwind via sync `PromptSignal` throw/catch. An async mid-call would need a redesigned prompt and tx boundary story, not only async HTTP.

### 7. Supervisor serializes all iframe entries

Even if two UI `functionCall`s are issued concurrently, `addCallHandler` wraps every dispatch in `serialize()` (`window-messaging.ts`). Concurrent entry tests confirm overlapping `entry` calls are queued, not parallel. So **multiple simultaneous plugin fetches are impossible at the Supervisor ingress today**, independent of XHR vs `fetch`.

(Within a single sync plugin call, overlapping fetches are also impossible: one WASM stack, one sync import at a time.)

---

## What is already async (and what that does *not* buy)

| Surface | Async? | Notes |
|---------|--------|-------|
| UI → Supervisor `functionCall` | Yes | Promise over `postMessage` |
| Plugin download / jco transpile / instantiate | Yes | Happens in `preload` / `entry` before the sync call |
| Page-origin HTTP in apps (`common-lib` `rpc.ts` `fetch`) | Yes | Bypasses plugins; subject to normal web origin/CSP rules |
| Plugin HTTP via `host:http` | **No** | Sync XHR on the bridge |
| Plugin KV via `host:db` | **No** | `localStorage` / `sessionStorage` |
| Overlapping Supervisor entries | **No** | Global serialize queue |

So the UI can stay responsive to *other* work while awaiting one `functionCall` reply, but:

1. That call’s internal I/O still holds the Supervisor thread with sync XHR.
2. A second plugin call waits in the serializer until the first `entry` fully completes (including its sync fetches).
3. True overlapping plugin fetches need both async bridge imports **and** a concurrency model for `entry` (or overlapping I/O inside one async entry).

---

## Planned path (already sketched in-repo)

From [`scratch/plugin-composition-02-v1.md`](scratch/plugin-composition-02-v1.md):

```
now:   UI → entry() → [WASM…] ──sync──► localStorage / XHR
goal:  UI → entry() → [composite] ──async──► IndexedDB / fetch / prompt
```

Ordering the plan already assumes:

1. **Host fold / composition first** — remaining mid-call JS should be bridge leaves only, not async-`syncCall` between two instantiates.
2. **Then** async Supervisor JS I/O: jco / component-model async imports; bridge `db*` → IndexedDB; `entry` / `start-tx` / call / `finish-tx` become async; optional `sendRequest` → `fetch`.
3. **Later** drop sync-XHR binary workarounds once `fetch` + `arrayBuffer()` is real (deferred item 6 in that doc).

Anti-pattern explicitly rejected: “Make `syncCall` async so IndexedDB works across two composites.”

---

## Relevance of jco PR [#2308](https://github.com/bytecodealliance/jco/pull/2308)

**What it fixed (merged 2026-10-24; released in `js-component-bindgen` v2.17.0):** with `--async-mode=jspi`, marking an **exported** resource constructor or static as async emitted `await` in the body but did not make the JS function async (parse failure). Statics get `{maybe_async}`; constructors wrap work in `return (async () => { ... })();` because JS cannot have an `async constructor`.

**Relevance to psibase:**

| Today | After a JSPI asyncification wave |
|-------|----------------------------------|
| No `--async-mode=jspi` → PR does not affect current runtime | Needed if async **exports** include resource constructors/statics |
| Custom `addResourceProxy` builds **sync** JS constructors calling `syncCallResource` | That proxy path must be redesigned for async independently of #2308 |
| Planned cut is mostly async **imports** (bridge `send-request`, `db.*`) | #2308 is export-side constructor/static codegen; still a prerequisite if any exported resources are marked async |

Psibase pins jco **1.35.0**. Any JSPI work that relies on correct async constructor/static codegen needs a jco bump that includes this fix (or equivalent). Browser runtime also needs JSPI available (`WebAssembly.Suspending` / experimental flags depending on engine).

---

## Mental model

```
┌─ App UI ──────────────────────────────────────────┐
│  functionCall → Promise (postMessage)    ASYNC    │
└───────────────────────┬───────────────────────────┘
                        ▼
┌─ Supervisor iframe (serialize: one entry at a time) ┐
│  preload / jco generate / instantiate     ASYNC     │
│  start-tx → call → finish-tx              SYNC      │
│    WASM + syncCall proxies                          │
│    host:http → bridge.send-request → sync XHR       │
│    host:db   → bridge.database → localStorage       │
└─────────────────────────────────────────────────────┘
```

**Root constraint:** sync component-model lowering + sync WIT bridge + sync call stack through plugins. Sync XHR and LocalStorage are the browser APIs chosen to match that ABI. **Unlock for non-blocking / overlapping plugin fetches:** JSPI (or CM async) on bridge imports, async `entry`/tx boundaries, and a concurrency story beyond the current global serializer—after composition makes bridge-only leaves the remaining JS I/O on the hot path.

---

## Cloud agent clarification

_Added 2026-10-29 by Michael's assistant. Expands the three unlock items above into concrete work. Line numbers are from this branch's base (`8663bc165`). Items marked **(unverified)** need a spike to confirm._

### 1. JSPI on bridge imports

- **WIT probably does not need to change for JSPI.** Under JSPI the guest still sees a *sync* import: the JS host returns a Promise, and `WebAssembly.Suspending` parks the Wasm stack until it resolves. So `send-request` in `Host/plugin/*/wit/deps/supervisor.wit` (6 copies: client, auth, db, prompt, crypto, http) can stay `func`. Changing it to CM `async func` is the *other* option (component-model async/WASIp3). That changes guest bindings and is a much larger change, so don't take it in this wave.
- **Rust guest impact under JSPI: none expected.** `HttpRequest::send` → `Supervisor::send_request` stays blocking-style Rust. **(unverified):** whether the wit-bindgen version we use emits anything that breaks across a suspension, e.g. re-entrancy guards.
- **jco:** bump `@bytecodealliance/jco` from 1.35.0 (`Supervisor/ui/package.json:13`) to a release that includes the JSPI codegen fixes, at least the one carrying jco #2308 (js-component-bindgen ≥ 2.17.0). Then extend `GenerateOptions` (`loader.ts:232-241`) with the async-mode / async-imports / async-exports equivalents of the CLI flags `--async-mode jspi --async-imports … --async-exports …`. The docs still call these flags EXPERIMENTAL. **(unverified):** the exact property names in the programmatic `generate()` API. Check them against the bumped version's types.
- **Imports to mark async (first cut):** `supervisor:bridge/intf#send-request` and `supervisor:bridge/database#get|set|remove`. Later candidates: `sign`/`sign-explicit`/`import-key*`, for SubtleCrypto, which is async-only. Leave `prompt#request-prompt`, `service-stack`, `get-root-domain` and `get-chain-id` sync.
- **Exports to mark async:** every plugin export that can transitively reach an async import. In practice that's all of them, because any plugin may call `host:http`/`host:db`. Each one becomes `WebAssembly.promising`-wrapped and returns a Promise to JS.
- **Browser support:** JSPI is in Chrome/Edge 137+, Firefox 153+ and Safari/iOS 27+ (Baseline "newly available" since 2026-09-14). Older Safari/iOS (≤26) has none, so decide on a fallback, either keeping the sync path or refusing to run (see Open questions).

### 2. Async entry and transaction boundaries

| Site | Today | Change |
|------|-------|--------|
| `supervisor.ts:452-528` `entry` | sync `supervisorCall(start-tx)` → `this.call` → `supervisorCall(finish-tx)` | `await` all three; `start-tx`/`finish-tx` are plugin exports, so they become promising too |
| `plugin/plugin.ts:170-190` `Plugin.call` | `return func(...params)` | `return await func(...params)` (async method) |
| `loader.ts:114-122` interface proxies → `host.syncCall` | sync closure | Must become a **`WebAssembly.Suspending` import** that awaits the callee's promising export. Nested JSPI suspension across two instances is allowed, but the composition plan rejects async-`syncCall` between composites. So land **host fold / composition first** so this path mostly disappears; whatever remains must be Suspending |
| `loader.ts:136-200` `addResourceProxy` | JS `constructor` calls `syncCallResource` | A constructor can't be async. Use a Suspending factory, or jco's #2308 pattern (`return (async () => …)()`). **(unverified)** how jco's generated import glue expects an async resource constructor |
| `plugin-host.ts:269-280` `syncCall*` | thin sync wrappers | rename/convert to async |
| `plugin-host.ts:125-…` `sendRequest` | sync XHR + `x-user-defined` byte hack | `fetch` + `arrayBuffer()`; drop the binary workaround |
| `plugin-host.ts:219-237` `db*` | `localStorage`/`sessionStorage` + base64 | IndexedDB store keyed by `(duration, key)`, storing `Uint8Array` directly; one-time migration that copies existing localStorage keys over then deletes them; keep session-duration semantics (in-memory map or IDB cleared per session) |
| `supervisor.ts:71`, `326-331` `PromptSignal` | thrown from a sync import, unwinds the Wasm stack synchronously | A throw from a Suspending import rejects the promise and unwinds through the promising export (this should behave like a trap). Verify that the `instanceof PromptSignal` checks in `entry` (`497-515`) still see the original object and not a wrapped `WebAssembly.Exception`/`RuntimeError` **(unverified)**. Note: the instance is poisoned after a trap, so `disposeAll()` in `finally` must stay |

Also check `preload` (`supervisor.ts` ~`440-448`) and `getJson`-style handlers that call plugins: every caller of `Plugin.call` becomes async.

### 3. Concurrency beyond the global serializer

`window-messaging.ts:8-20` wraps every handler in `serialize()` (`serialize.ts:1-12`, a single module-level promise chain). `supervisor-concurrent-entry.test.ts` asserts that behavior. Even with async I/O, a single `entry` can't overlap with another one, because `Supervisor` keeps per-call mutable state on `this` (`context`, call stack, parent origination, `plugins.instantiateAll/disposeAll`, the tx context in `transact`).

Options, in increasing difficulty:
1. **Keep the global queue, async inside (recommended first).** The Supervisor thread is no longer blocked, the UI stays responsive, and one plugin can overlap its own fetches only if Rust guest code ever issues them concurrently (it can't under JSPI sync-style calls). Lowest risk.
2. **Per-tx isolation and a queue per caller/app.** Move `context`/call stack/origination/tx state into a per-entry object passed down (or `AsyncLocalStorage`-like, which the browser doesn't have, so pass it explicitly). Separate component instances per entry, or proof that plugin instances are reentrancy-safe. `transact`'s tx context must be per-entry. Ordering: FIFO per origin, no ordering across origins.
3. **Read-only parallelism.** Let entries that never call `add-action`/`finish-tx` submit run concurrently. That needs a way to know or enforce read-only (e.g. a query-only entry message type).
4. **Overlapping fetches inside one call.** Needs CM async (`async func`, streams/futures) in the guest, not just JSPI. That's out of scope until WASIp3/jco CM-async support matures.

Invariants to keep: prompts must still be exclusive (one prompt at a time); tx action order within an entry stays deterministic; `disposeAll` must not tear down instances used by another in-flight entry.

### Phased migration

| Phase | Scope | Files |
|-------|-------|-------|
| 0 Spike | jco bump; JSPI on `send-request` only; one test plugin; confirm PromptSignal and resource-proxy behavior | `Supervisor/ui/package.json`, `loader.ts:232-241`, `plugin-host.ts` |
| 1 Composition | finish host fold so mid-call JS is bridge leaves only | per `scratch/plugin-composition-02-v1.md` |
| 2 Async boundary | async `entry`/`Plugin.call`/start-tx/finish-tx; Suspending proxies; async resource proxies | `supervisor.ts`, `plugin/plugin.ts`, `loader.ts:114-200`, `plugin-host.ts:239-280`, `host-interface.ts`, tests |
| 3 Async I/O | `fetch` in `sendRequest`; IndexedDB for `db*` + migration; update spec text | `plugin-host.ts:125-237`, `doc/src/specifications/app-architecture/plugins.md` |
| 4 Concurrency (optional) | per-entry state, then per-origin queues | `window-messaging.ts`, `serialize.ts`, `supervisor.ts`, `call-context.ts`, `call-stack.ts`, `supervisor-concurrent-entry.test.ts` |

### Risks

- jco JSPI support is flagged experimental, so expect codegen bugs like #2308. Pin the version and add Supervisor-level tests.
- Browsers without JSPI (Safari/iOS < 27) run the retained sync XHR / localStorage fallback (decided above). Keeping two paths doubles the test surface, and both must stay behavior-compatible.
- Error semantics: traps/rejections through promising exports may change how `getRecoverableError` and `PromptSignal` are detected.
- localStorage → IndexedDB data migration (JSPI path only): users lose plugin state if the migration fails, and private-mode IDB quirks are a concern. Because the fallback stays on localStorage, the two backends must hold the same logical data, and a user who moves between a JSPI and a non-JSPI browser must not see diverging state.
- Async adds interleaving points. Even with the global queue, UI-side events (e.g. logout) can now run mid-entry.

### Open questions

**Resolved (2026-10-29):** JSPI is the primary path everywhere it is supported. The sync XHR / localStorage path is kept as the fallback for browsers without JSPI. No browser/UA sniffing: the Supervisor uses JSPI where it is available and the sync path where it is not.

**Resolved (2026-10-29), concurrency beyond option 1:** the global one-at-a-time queue is fine for this round of work. **Deferred:** eventually allow multiple entries or separate instances to run concurrently, so one call paused on a fetch doesn't block the next. That is out of scope for the current three-step JSPI work.

**Resolved (2026-10-29), long-term target:** component-model async (`async func`, WASI Preview 3) is the long-term target, since only it gives in-call parallel fetches. **Deferred** until the Wasm standard supports it; current work stays on the JSPI core-module path.

**Resolved (2026-10-29), crypto imports:** **Deferred.** Moving crypto imports to async SubtleCrypto is not part of this round.


## Playwright e2e harness plan

### Open items
1. **Measure devnet boot time (on a typical dev machine and in a CI-like environment) before committing to a pool of pre-warmed chains.** This is unprofiled; booting a chain per spec could add minutes per run.
2. Deferred: open up the Supervisor's global queue to allow concurrent plugin entries / separate instances for multi-call parallelism.
3. Deferred: move to component-model async (WASI Preview 3) when the Wasm standard supports it.
4. Deferred: move crypto imports to async SubtleCrypto.

#### Why serial `entry` is a massive simplifier (re: open item 2)

Keeping `entry` calls serial is not just a queue preference — it avoids inventing concurrent transaction construction.

Today there is effectively **one open transaction** for the live plugin graph: `start-tx` → plugins append into `OpenTx` (a single ephemeral `host:db` bucket in `packages/system/Transact/plugin/shared/open_tx_table.rs`) → `finish-tx` takes/submits it. That ledger is process-global for the instance, not keyed by call. Supervisor also keeps one `CallContext` / call stack, one parent-origination slot, and prompt unwind that assumes a single in-flight tree.

If two `entry`s ran at once without isolation, they would race the same action list, latches, sender hook, and stack. Parallel `entry`s therefore need a real multi-tx / multi-context design, not a small `serialize` tweak — at least:

- **Per-entry tx construction** (separate `OpenTx`, tx-id’d storage, or separate component instances so ephemeral DB does not collide)
- **Per-entry call stack / context** (and rules for which stack `get-sender` / bucket keys see)
- **Prompt exclusivity** (still one UI prompt at a time, or a prompt queue)
- **Lifecycle rules** so `disposeAll` / instantiate does not tear down another entry’s graph

**Implication for phasing:** Phase 1 (JSPI / `fetch` / async `entry`) with the global queue kept gets non-blocking I/O without concurrent tx builders. Opening the queue (this deferred item) is the step that demands multi-tx and multi-context management — which is why it stays out of the current JSPI wave. (In-call overlapping fetches are a separate deferred track: open item 3 / WASIp3.)

### Plan
- **Scope: local development only for now.** This harness is a facility for developers to run on their own machines. Do not add it to CI yet; CI integration is a future decision.
- **Location:** a top-level `e2e/` directory, shared team-wide, not inside the Supervisor package.
- **Browsers:** Chromium first (JSPI available), plus WebKit to cover current Safari. Pin browser versions.
- **Parallelism:** Chromium and WebKit run in parallel as separate CI-style jobs, each with its own isolated chain / pool slot and no shared ports or endpoints. Per-job isolation is what makes parallel runs safe.
- **Chain:** a fresh local devnet per run is problematic (test package install and chain state), so prefer a pool of pre-warmed chains, pending the boot-time measurement above.
- **Keys:** no CI secrets. Each test uses throwaway keypairs: create, fund, use, discard.
- **Layout:** shared root config and fixtures, with per-package spec subdirectories globbed in.
- **Fixtures:**
  - Boot the Supervisor in the page against the job's chain.
  - Load any plugin by service/plugin id.
  - Drive the bridge from the test side (issue `send-request` / database calls and observe results).
  - A sleep-and-timestamp fixture plugin: each call sleeps for a given time and returns start/end timestamps, so fetch overlap can be proven without real network.
- **One run command** for the whole suite.
- **PR sequencing:** a harness PR first, including at least one smoke test proving the harness boots (chain up, Supervisor loaded, one plugin call succeeds), then stacked PRs, one per async piece. Develop both in one working tree and selectively stage into two commits.

### Coverage split
- **Vitest in happy-dom (existing tooling)** covers the async plumbing: ordering of entry / start-tx / call / finish-tx, the queue holding while a fetch is pending, prompt unwind through an async call, rejected fetches mapping to the right errors, and a fake async bridge including the localStorage → IndexedDB migration. It cannot exercise real JSPI.
- **Playwright plus a jco-built test plugin** is needed for real JSPI suspension. Pair it with a mock HTTP server that delays each request by a different amount, so parallelism shows up in the order responses finish.
- **Also:** add a CI step for the existing Vitest suite, which today is only run by hand.

### Recommended new e2e tests
- **Concurrent fetches:** overlapping fetches overlap in wall-clock time instead of serializing (total time close to the longest delay, not the sum).
- **Correctness vs blocking:** responses match what the blocking fetch returns today, with no reordering surprises.
- **Database ops:** get / set / remove go through the same async path and return the same results.
- **JSPI-less fallback:** in an environment without JSPI, the suite still runs and passes on the retained sync XHR / localStorage fallback, with the same results as the JSPI path (overlap assertions are skipped there).
