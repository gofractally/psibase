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
export const KEEPALIVE_BODY_LIMIT = 64 * 1024;

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
//   until `flush`.
export class HostDb {
    private cache = new Map<string, Uint8Array | null>();

    // Keys known absent from the node (404).
    private negativeCache = new Set<string>();

    private queue: BatchOp[] = [];

    // Drops in-memory read caches and any queued writes not yet flushed.
    clear(): void {
        this.cache.clear();
        this.negativeCache.clear();
        this.queue = [];
    }

    // Flushes queued writes, then drops read caches even when flush fails.
    async flushAndClear(): Promise<void> {
        try {
            await this.flush();
        } finally {
            this.clear();
        }
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

    // Flushes all queued writes to hostdb; throws on non-OK HTTP response.
    async flush(): Promise<void> {
        if (this.queue.length === 0) {
            return;
        }
        const ops = this.queue;
        this.queue = [];
        const body = JSON.stringify({ ops });
        const res = await fetch(siblingUrl(null, "hostdb", "/kv/batch"), {
            method: "POST",
            credentials: "include",
            ...(body.length <= KEEPALIVE_BODY_LIMIT ? { keepalive: true } : {}),
            headers: { "Content-Type": "application/json" },
            body,
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
    }
}
