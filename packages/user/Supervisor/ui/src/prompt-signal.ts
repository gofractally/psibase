export class PromptSignal extends Error {
    constructor(readonly kind: "prompt" | "embedded-error" | "preload-error") {
        super(`prompt-signal:${kind}`);
        this.name = "PromptSignal";
    }
}

// JSPI turns a throw from a non-suspending import into a wasm trap, and jco
// then waits forever on task.completionPromise(). Stash the signal so JS
// callers can reject immediately.
let lastPromptSignal: PromptSignal | undefined;

export function setPromptSignal(signal: PromptSignal): void {
    lastPromptSignal = signal;
}

export function peekPromptSignal(): PromptSignal | undefined {
    return lastPromptSignal;
}

export function takePromptSignal(): PromptSignal | undefined {
    const signal = lastPromptSignal;
    lastPromptSignal = undefined;
    return signal;
}

export function promptSignalKind(
    e: unknown,
    depth = 0,
): PromptSignal["kind"] | undefined {
    if (depth > 6 || e == null || typeof e !== "object") {
        return undefined;
    }
    if (e instanceof PromptSignal) {
        return e.kind;
    }
    const rec = e as { name?: unknown; message?: unknown; cause?: unknown };
    if (
        typeof rec.message === "string" &&
        rec.message.startsWith("prompt-signal:")
    ) {
        const kind = rec.message.replace(/^prompt-signal:/, "");
        if (
            kind === "prompt" ||
            kind === "embedded-error" ||
            kind === "preload-error"
        ) {
            return kind;
        }
    }
    if (rec.name === "PromptSignal" && typeof rec.message === "string") {
        const kind = rec.message.replace(/^prompt-signal:/, "");
        if (
            kind === "prompt" ||
            kind === "embedded-error" ||
            kind === "preload-error"
        ) {
            return kind;
        }
    }
    return promptSignalKind(rec.cause, depth + 1);
}

export function settleOrPrompt<T>(value: T | Promise<T>): T | Promise<T> {
    if (
        typeof value !== "object" ||
        value === null ||
        typeof (value as Promise<T>).then !== "function"
    ) {
        const signal = peekPromptSignal();
        if (signal) throw signal;
        return value;
    }
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (fn: (v: T) => void, v: T) => {
            if (settled) return;
            settled = true;
            clearInterval(timer);
            fn(v);
        };
        const timer = setInterval(() => {
            const signal = peekPromptSignal();
            if (signal) {
                if (settled) return;
                settled = true;
                clearInterval(timer);
                reject(signal);
            }
        }, 0);
        Promise.resolve(value as Promise<T>).then(
            (v) => finish(resolve, v),
            (e) => {
                if (settled) return;
                settled = true;
                clearInterval(timer);
                reject(peekPromptSignal() ?? e);
            },
        );
    });
}
