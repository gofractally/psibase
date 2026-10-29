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
