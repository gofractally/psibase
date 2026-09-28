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

    private queue: BatchOp[] = [];

    clear(): void {
        this.cache.clear();
        this.queue = [];
    }

    // `send` is the synchronous request path. Throws on any response other
    //   than a value or 404 (absent).
    get(
        duration: number,
        key: string,
        send: (req: HttpRequest) => HttpResponse,
    ): Uint8Array | null {
        const path = `${durationName(duration)}/${key}`;
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
        } else if (res.status === 404) {
            value = null;
        } else {
            throw hostDbError(`Read failed: HTTP ${res.status}`);
        }
        this.cache.set(path, value);
        return value;
    }

    set(duration: number, key: string, value: Uint8Array): void {
        const name = durationName(duration);
        this.cache.set(`${name}/${key}`, value);
        this.queue.push({
            duration: name,
            key,
            value: bytesToBase64Url(value),
        });
    }

    remove(duration: number, key: string): void {
        const name = durationName(duration);
        this.cache.set(`${name}/${key}`, null);
        this.queue.push({ duration: name, key, value: null });
    }

    // Sends every queued write as one batch. Rejects if the batch is not
    //   applied.
    async flush(): Promise<void> {
        if (this.queue.length === 0) {
            return;
        }
        const ops = this.queue;
        this.queue = [];
        const res = await fetch(siblingUrl(null, "hostdb", "/kv/batch"), {
            method: "POST",
            credentials: "include",
            keepalive: true,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ops }),
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
    }
}
