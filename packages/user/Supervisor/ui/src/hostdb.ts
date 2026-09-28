import { siblingUrl } from "@psibase/common-lib";

import { bytesToBase64Url } from "./client-key";
import { HttpRequest, HttpResponse } from "./host-interface";
import { RecoverableErrorPayload } from "./plugin/errors";

const DURATIONS = ["persistent", "session"] as const;
type Duration = (typeof DURATIONS)[number];

interface BatchOp {
    duration: Duration;
    key: string;
    value: string | null;
}

// Browsers reject keepalive request bodies larger than 64 KiB.
const KEEPALIVE_BODY_LIMIT = 64 * 1024;

function serializeBatchBody(ops: BatchOp[]): string {
    return JSON.stringify({ ops });
}

function splitBatchOps(ops: BatchOp[]): BatchOp[][] {
    const batches: BatchOp[][] = [];
    let current: BatchOp[] = [];

    for (const op of ops) {
        const withOp = [...current, op];
        if (serializeBatchBody(withOp).length <= KEEPALIVE_BODY_LIMIT) {
            current = withOp;
            continue;
        }

        if (current.length > 0) {
            batches.push(current);
            current = [op];
            if (serializeBatchBody(current).length > KEEPALIVE_BODY_LIMIT) {
                batches.push(current);
                current = [];
            }
        } else {
            batches.push([op]);
        }
    }

    if (current.length > 0) {
        batches.push(current);
    }

    return batches;
}

function durationName(duration: number): Duration {
    const name = DURATIONS[duration];
    if (name === undefined) {
        throw hostDbError(`Invalid storage duration: ${duration}`);
    }
    return name;
}

function hostDbError(message: string): RecoverableErrorPayload {
    return {
        code: 0,
        producer: { service: "host", plugin: "db" },
        message,
    };
}

// The `supervisor:bridge/database` store for one entry point, backed by the
//   `hostdb` service. Reads are cached; writes update the cache and are queued
//   until `flush`. `clear` must be called at the start of every entry point.
export class HostDb {
    private cache = new Map<string, Uint8Array | null>();

    // Keys known absent from the node (404). Survives `clear` for this profile.
    private negativeCache = new Set<string>();

    private queue: BatchOp[] = [];

    clear(): void {
        this.cache.clear();
        this.queue = [];
    }

    // `send` is the synchronous request path. Throws on any response other
    //   than a value or 404 (absent). `debugKey` is the plaintext
    //   `{mode}:{service}:{identifier}:{key}`; it is named on a miss and is
    //   not sent to the node.
    get(
        duration: number,
        key: string,
        debugKey: string,
        send: (req: HttpRequest) => HttpResponse,
    ): Uint8Array | null {
        const path = `${durationName(duration)}/${key}`;
        if (this.negativeCache.has(path)) {
            return null;
        }
        const cached = this.cache.get(path);
        if (cached !== undefined) {
            return cached;
        }

        const res = send({
            uri: siblingUrl(null, "hostdb", `/kv/${path}`),
            method: "GET",
            headers: [{ key: "Accept", value: "application/octet-stream" }],
        });
        let value: Uint8Array | null;
        if (res.status === 200) {
            value = res.body ? (res.body.val as Uint8Array) : new Uint8Array();
            this.negativeCache.delete(path);
        } else if (res.status === 404) {
            value = null;
            this.negativeCache.add(path);
            console.info(`host:db missing key: ${debugKey}`);
        } else {
            throw hostDbError(`Read failed: HTTP ${res.status}`);
        }
        this.cache.set(path, value);
        return value;
    }

    set(duration: number, key: string, value: Uint8Array): void {
        const name = durationName(duration);
        const path = `${name}/${key}`;
        this.negativeCache.delete(path);
        this.cache.set(path, value);
        this.queue.push({
            duration: name,
            key,
            value: bytesToBase64Url(value),
        });
    }

    remove(duration: number, key: string): void {
        const name = durationName(duration);
        const path = `${name}/${key}`;
        this.negativeCache.add(path);
        this.cache.set(path, null);
        this.queue.push({ duration: name, key, value: null });
    }

    // Sends every queued write, splitting into multiple batches when the
    //   serialized body would exceed the browser keepalive limit. Rejects if
    //   any batch is not applied.
    async flush(): Promise<void> {
        if (this.queue.length === 0) {
            return;
        }
        const ops = this.queue;
        this.queue = [];
        const batches = splitBatchOps(ops);
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const body = serializeBatchBody(batch);
            const isLast = i === batches.length - 1;
            const res = await fetch(siblingUrl(null, "hostdb", "/kv/batch"), {
                method: "POST",
                credentials: "include",
                ...(isLast && body.length <= KEEPALIVE_BODY_LIMIT
                    ? { keepalive: true }
                    : {}),
                headers: { "Content-Type": "application/json" },
                body,
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
        }
    }
}
