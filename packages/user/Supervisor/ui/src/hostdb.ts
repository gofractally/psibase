import { siblingUrl } from "@psibase/common-lib";

import { HttpRequest, HttpResponse } from "./host-interface";
import { RecoverableErrorPayload } from "./plugin/errors";

const DURATIONS = ["persistent", "session"] as const;
type Duration = (typeof DURATIONS)[number];

interface BatchOp {
    duration: Duration;
    key: string;
    // Base64 ciphertext to store, null to delete, omitted to only check `expected`.
    value?: string | null;
    // SHA-256 hex of the ciphertext from GET, or null when that GET was absent.
    // Omitted when this call has not read the key.
    expected?: string | null;
}

const FLUSH_ATTEMPTS = 4;
const FLUSH_RETRY_BASE_MS = 100;

async function postBatch(body: string): Promise<void> {
    const init: RequestInit = {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body,
    };
    const url = siblingUrl(null, "hostdb", "/kv/batch");
    for (let attempt = 0; attempt < FLUSH_ATTEMPTS; attempt++) {
        let res: Response;
        try {
            res = await fetch(url, init);
        } catch (e) {
            if (attempt + 1 >= FLUSH_ATTEMPTS) {
                throw e;
            }
            await new Promise((resolve) => {
                setTimeout(resolve, FLUSH_RETRY_BASE_MS * 2 ** attempt);
            });
            continue;
        }
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        return;
    }
}

function storagePath(duration: Duration, key: string): string {
    return `${duration}/${key}`;
}

function parseStoragePath(path: string): { duration: Duration; key: string } {
    const separator = path.indexOf("/");
    return {
        duration: path.slice(0, separator) as Duration,
        key: path.slice(separator + 1),
    };
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

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

// The `supervisor:bridge/database` store for one entry point, backed by the
//   `hostdb` service. Reads are cached; writes update the cache and are queued
//   until `flush`. Each read remembers the server ciphertext. A write for a
//   key that was read sends the SHA-256 of that ciphertext (or null when the
//   read was absent). A read with no write sends that expectation and no
//   `value`. The queue keeps the last op for each (duration, key).
export class HostDb {
    private cache = new Map<string, Uint8Array | null>();

    private observed = new Map<string, Uint8Array | null>();

    private queue = new Map<string, BatchOp>();

    // Drops in-memory read caches and any queued writes not yet flushed.
    clear(): void {
        this.cache.clear();
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
        const path = storagePath(durationName(duration), key);
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
            this.observed.set(path, value.slice());
        } else if (res.status === 404) {
            value = null;
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
        const path = storagePath(name, key);
        this.cache.set(path, value);
        this.enqueue({
            duration: name,
            key,
            value: value.toBase64({ alphabet: "base64" }),
        });
    }

    remove(duration: number, key: string): void {
        const name = durationName(duration);
        const path = storagePath(name, key);
        this.cache.set(path, null);
        this.enqueue({ duration: name, key, value: null });
    }

    // Sends queued writes, then a check for each read that was not written.
    // A rejected POST is retried with increasing delay; throws after those
    // attempts, or on a non-OK response.
    async flush(): Promise<void> {
        const written = new Set(this.queue.keys());
        const queued = [...this.queue.values()];
        this.queue.clear();
        const writes = await Promise.all(
            queued.map((op) => this.withExpected(op)),
        );
        const checks = await Promise.all(
            [...this.observed.entries()]
                .filter(([path]) => !written.has(path))
                .map(async ([path, observed]) => {
                    const { duration, key } = parseStoragePath(path);
                    return {
                        duration,
                        key,
                        expected: await this.expectation(observed),
                    };
                }),
        );
        const ops = [...writes, ...checks];
        if (ops.length === 0) {
            return;
        }
        await postBatch(JSON.stringify({ ops }));
    }

    // Last write for a (duration, key) replaces any earlier op this call.
    private enqueue(op: BatchOp): void {
        this.queue.set(storagePath(op.duration, op.key), op);
    }

    private async withExpected(op: BatchOp): Promise<BatchOp> {
        const observed = this.observed.get(storagePath(op.duration, op.key));
        if (observed === undefined) {
            return op;
        }
        return { ...op, expected: await this.expectation(observed) };
    }

    private async expectation(
        observed: Uint8Array | null,
    ): Promise<string | null> {
        return observed === null ? null : sha256Hex(observed);
    }
}
