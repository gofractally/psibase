// @vitest-environment node
//
// TEMP diagnostic repro for the prompt.html "second get-active-prompt
// panics with a zeroed bucket" bug.
//
// Drives the real composed host composite (host:prompt + host:call-context +
// host:db + host:session + host:authed-http + tracers) exactly like the
// supervisor loader does (same jco
// options + jco-reenter patch), with stubbed supervisor bridge imports.
//
// Produce the composite first:
//   DUMP_HOST_COMPOSITE=/tmp/host_composite.wasm cargo test \
//     --target x86_64-unknown-linux-gnu --test real_wasm \
//     compose_real_host_with_tracers
// (run in packages/user/CommonApi/common/packages/plugin-composer)
import { generate } from "@bytecodealliance/jco/component";
import * as cliNs from "@bytecodealliance/preview2-shim/cli";
import * as clocksNs from "@bytecodealliance/preview2-shim/clocks";
import * as filesystemNs from "@bytecodealliance/preview2-shim/filesystem";
import * as ioNs from "@bytecodealliance/preview2-shim/io";
import * as randomNs from "@bytecodealliance/preview2-shim/random";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { fixJcoResourceTables, makeJcoReenterable } from "./jco-reenter";

const COMPOSITE_PATH = "/tmp/host_composite.wasm";

/* eslint-disable @typescript-eslint/no-explicit-any */
const cli = cliNs as any;
const clocks = clocksNs as any;
const filesystem = filesystemNs as any;
const io = ioNs as any;
const random = randomNs as any;

function wasiImports(): Record<string, unknown> {
    return {
        "wasi:cli/environment": cli.environment,
        "wasi:cli/exit": cli.exit,
        "wasi:cli/stderr": cli.stderr,
        "wasi:cli/stdin": cli.stdin,
        "wasi:cli/stdout": cli.stdout,
        "wasi:clocks/wall-clock": clocks.wallClock,
        "wasi:clocks/monotonic-clock": clocks.monotonicClock,
        "wasi:filesystem/types": filesystem.types,
        "wasi:filesystem/preopens": filesystem.preopens,
        "wasi:io/error": io.error,
        "wasi:io/streams": io.streams,
        "wasi:random/random": random.random,
    };
}

function throwingStub(name: string): unknown {
    return new Proxy(
        {},
        {
            get(_t, prop) {
                if (typeof prop === "symbol") return undefined;
                return (...args: unknown[]) => {
                    throw new Error(
                        `stub import called: ${name}.${String(prop)}(${JSON.stringify(args)})`,
                    );
                };
            },
        },
    );
}

interface Harness {
    exports: Record<string, any>;
    stack: string[];
    frames: string[];
    kv: Map<string, Uint8Array>;
    log: string[];
}

async function instantiateHostComposite(): Promise<Harness> {
    const wasmBytes = new Uint8Array(readFileSync(COMPOSITE_PATH));

    const { files } = await generate(wasmBytes, {
        name: "component",
        noTypescript: true,
        instantiation: { tag: "async" },
        noNodejsCompat: true,
        tlaCompat: false,
        validLiftingOptimization: false,
        noNamespacedExports: false, // composites use namespaced exports
        tracing: false,
    });

    const coreModules = new Map<string, WebAssembly.Module>();
    let jsSource: string | null = null;
    for (const [fileName, content] of files) {
        if (fileName.endsWith(".wasm")) {
            const bytes = content as Uint8Array;
            const buf = bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer;
            coreModules.set(fileName, await WebAssembly.compile(buf));
        } else if (fileName.endsWith(".js")) {
            jsSource = new TextDecoder().decode(content as Uint8Array);
        }
    }
    if (!jsSource) throw new Error("jco produced no JS");
    jsSource = fixJcoResourceTables(jsSource);
    jsSource = makeJcoReenterable(jsSource);

    // Instrument jco's resource handle tables to trace rep/handle flow.
    // These declarations live inside instantiate(), so inject there.
    const INSTRUMENT = `
const __cb = rscTableCreateBorrow;
rscTableCreateBorrow = function (table, rep) {
  const h = __cb(table, rep);
  console.log("[rsc] createBorrow tid=" + handleTables.indexOf(table) + " rep=" + rep + " -> h=" + h + " head=" + table[0] + " tbl=[" + table + "]");
  return h;
};
const __co = rscTableCreateOwn;
rscTableCreateOwn = function (table, rep) {
  const h = __co(table, rep);
  console.log("[rsc] createOwn tid=" + handleTables.indexOf(table) + " rep=" + rep + " -> h=" + h + " head=" + table[0] + " tbl=[" + table + "]");
  return h;
};
const __rm = rscTableRemove;
rscTableRemove = function (table, handle) {
  const r = __rm(table, handle);
  console.log("[rsc] remove tid=" + handleTables.indexOf(table) + " h=" + handle + " -> rep=" + r.rep + " own=" + r.own + " head=" + table[0] + " tbl=[" + table + "]");
  return r;
};
const __tb = resourceTransferBorrow;
resourceTransferBorrow = function (handle, fromTid, toTid) {
  const r = __tb(handle, fromTid, toTid);
  console.log("[rsc] transferBorrow h=" + handle + " " + fromTid + "->" + toTid + " = " + r);
  return r;
};
const __to = resourceTransferOwn;
resourceTransferOwn = function (handle, fromTid, toTid) {
  const r = __to(handle, fromTid, toTid);
  console.log("[rsc] transferOwn h=" + handle + " " + fromTid + "->" + toTid + " = " + r);
  return r;
};
`;
    if (!jsSource.includes("let scopeId = 0;")) {
        throw new Error("instrumentation anchor not found");
    }
    jsSource = jsSource.replace(
        "let scopeId = 0;",
        `let scopeId = 0;\n${INSTRUMENT}`,
    );

    // Keep a copy on disk so the generated handle-table code can be read.
    const jsPath = join(tmpdir(), "host_composite.generated.mjs");
    writeFileSync(jsPath, jsSource);

    const mod = await import(/* @vite-ignore */ pathToFileURL(jsPath).href);

    const harness: Harness = {
        exports: {},
        stack: ["homepage", "supervisor"],
        frames: [],
        kv: new Map(),
        log: [],
    };

    const imports: Record<string, unknown> = {
        ...wasiImports(),
        "supervisor:bridge/types": {},
        "supervisor:bridge/intf": {
            sendRequest: (...args: unknown[]) => {
                throw new Error(`sendRequest not stubbed: ${JSON.stringify(args)}`);
            },
            serviceStack: () => [...harness.stack, ...harness.frames],
            getRootDomain: () => "http://psibase.localhost:8091",
            getChainId: () =>
                "000000020E2154FF7C9BC548DDE166B2ED708FED0A06071ADB71D210CC7BDF6F",
            sign: () => {
                throw new Error("sign not stubbed");
            },
            signExplicit: () => {
                throw new Error("signExplicit not stubbed");
            },
            importKey: () => {
                throw new Error("importKey not stubbed");
            },
        },
        "supervisor:bridge/database": {
            get: (duration: number, key: string) => {
                const v = harness.kv.get(`${duration}:${key}`);
                harness.log.push(`dbGet d=${duration} ${key} hit=${v !== undefined}`);
                return v ?? null;
            },
            set: (duration: number, key: string, value: Uint8Array) => {
                harness.log.push(`dbSet d=${duration} ${key} bytes=${value.length}`);
                harness.kv.set(`${duration}:${key}`, new Uint8Array(value));
            },
            remove: (duration: number, key: string) => {
                harness.kv.delete(`${duration}:${key}`);
            },
        },
        "supervisor:bridge/prompt": {
            requestPrompt: () => {
                harness.log.push("requestPrompt");
            },
        },
        "supervisor:callstack/callstack": {
            push: (service: string) => {
                harness.frames.push(service);
            },
            pop: () => {
                harness.frames.pop();
            },
        },
        // session's transact hop (get-query-token) stays a JS import.
        "transact:plugin/auth": throwingStub("transact:plugin/auth"),
        "host:types/types": throwingStub("host:types/types"),
        "accounts:query/api": {
            getCurrentUser: () => {
                harness.log.push("getCurrentUser");
                return "alice";
            },
        },
    };

    const getCoreModule = (path: string) => {
        const m = coreModules.get(path);
        if (!m) throw new Error(`missing core module ${path}`);
        return m;
    };

    harness.exports = await mod.instantiate(getCoreModule, imports);
    return harness;
}

async function drainFinalizers() {
    // FinalizationRegistry callbacks run on later macrotasks after gc.
    for (let i = 0; i < 5; i++) {
        if (typeof globalThis.gc === "function") globalThis.gc();
        await new Promise((r) => setTimeout(r, 0));
    }
}

describe.skipIf(!existsSync(COMPOSITE_PATH))("host composite bucket handles", () => {
    it("survives JS-driven bucket churn between get-active-prompt calls", async () => {
        const h = await instantiateHostComposite();
        const admin = h.exports["host:prompt/admin"];
        const api = h.exports["host:prompt/api"];
        const store = h.exports["host:db/store"];
        expect(admin).toBeTruthy();
        expect(api).toBeTruthy();
        expect(store).toBeTruthy();

        // 1. An app (accounts) sets the active prompt.
        h.stack = ["homepage", "accounts"];
        api.prompt("testprompt", undefined);

        // 2. The supervisor reads it back (preload path) — should work.
        h.stack = ["supervisor", "supervisor"];
        const d1 = admin.getActivePrompt();
        expect(d1.promptName).toBe("testprompt");
        expect(d1.activeApp).toBe("homepage");

        // 3. Simulate clientdata-style churn: construct buckets through the
        //    composite's JS export, use them, and drop the references.
        h.stack = ["supervisor", "clientdata"];
        for (let i = 0; i < 25; i++) {
            let b: any = new store.Bucket(
                { mode: "non-transactional", duration: "session" },
                `connected-accounts-${i}`,
            );
            b.set("k", new Uint8Array([1, 2, 3]));
            b.get("k");
            b = null;
        }

        await drainFinalizers();

        // 4. The entry path reads the active prompt again.
        h.stack = ["supervisor", "supervisor"];
        const d2 = admin.getActivePrompt();
        expect(d2.promptName).toBe("testprompt");
    }, 60_000);
});
