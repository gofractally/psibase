import { bytesToBase64Url, siblingUrl } from "@psibase/common-lib";

import { HttpRequest, HttpResponse } from "./host-interface";
import { RecoverableErrorPayload } from "./plugin/errors";

const DURATIONS = ["persistent", "session"] as const;
type Duration = (typeof DURATIONS)[number];

interface BatchOp {
    duration: Duration;
    key: string;
    value: string | null;
    // SHA-256 hex of the ciphertext from GET, or null when that GET was absent.
    // Omitted when this call has not read the key.
    expected?: string | null;
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

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

// The `supervisor:bridge/database` store for one entry point, backed by the
//   `hostdb` service. Reads are cached; writes update the cache and are queued
//   until `flush`. Each read remembers the server ciphertext. Batch ops for a
//   key that was read send the SHA-256 of that ciphertext (or null when the
//   read was absent). The queue keeps the last op for each (duration, key).
export class HostDb {
    private cache = new Map<string, Uint8Array | null>();

    // Keys known absent from the node (404).
    private negativeCache = new Set<string>();

    private observed = new Map<string, Uint8Array | null>();

    private queue = new Map<string, BatchOp>();

    // Drops in-memory read caches and any queued writes not yet flushed.
    clear(): void {
        this.cache.clear();
        this.negativeCache.clear();
        this.observed.clear();
        this.queue.clear();
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
            this.observed.set(path, value.slice());
        } else if (res.status === 404) {
            value = null;
            this.negativeCache.add(path);
            this.observed.set(path, null);
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
        this.enqueue({
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
        this.enqueue({ duration: name, key, value: null });
    }

    // Flushes all queued writes to hostdb; throws on non-OK HTTP response.
    async flush(): Promise<void> {
        if (this.queue.size === 0) {
            return;
        }
        const queued = [...this.queue.values()];
        this.queue.clear();
        const ops = await Promise.all(
            queued.map((op) => this.withExpected(op)),
        );
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

    // Last write for a (duration, key) replaces any earlier op this call.
    private enqueue(op: BatchOp): void {
        this.queue.set(`${op.duration}/${op.key}`, op);
    }

    private async withExpected(op: BatchOp): Promise<BatchOp> {
        const observed = this.observed.get(`${op.duration}/${op.key}`);
        if (observed === undefined) {
            return op;
        }
        return {
            ...op,
            expected: observed === null ? null : await sha256Hex(observed),
        };
    }
}
