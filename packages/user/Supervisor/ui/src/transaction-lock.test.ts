import { afterEach, describe, expect, it, vi } from "vitest";
import { withTransactionLock } from "./transaction-lock";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

function sharedLockManager() {
    let queue = Promise.resolve();
    const calls: { name: string; mode: string }[] = [];
    return {
        calls,
        request<T>(name: string, options: { mode: string }, run: () => Promise<T>): Promise<T> {
            calls.push({ name, mode: options.mode });
            const result = queue.catch(() => {}).then(run);
            queue = result.then(() => {}, () => {});
            return result;
        },
    };
}

describe("native cross-tab transaction lock", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("holds one origin-wide exclusive lock through the complete async context", async () => {
        const locks = sharedLockManager();
        vi.stubGlobal("navigator", { locks });
        const gate = deferred();
        const started = deferred();
        const order: string[] = [];
        const first = withTransactionLock(async () => {
            order.push("start-tx A"); started.resolve();
            await gate.promise;
            order.push("publish/finish A");
        });
        await started.promise;
        const second = withTransactionLock(async () => { order.push("start-tx B"); });
        await Promise.resolve();
        expect(order).toEqual(["start-tx A"]);
        gate.resolve();
        await Promise.all([first, second]);
        expect(order).toEqual(["start-tx A", "publish/finish A", "start-tx B"]);
        expect(locks.calls).toEqual([
            { name: "psibase-native-transaction", mode: "exclusive" },
            { name: "psibase-native-transaction", mode: "exclusive" },
        ]);
    });

    it("serializes copied-session check-and-spend so an unknown response cannot authorize twice", async () => {
        vi.stubGlobal("navigator", { locks: sharedLockManager() });
        let persistentSpent = false;
        let publicationAttempts = 0;
        const grantInOriginalTab = { approved: true };
        const copiedSession = structuredClone(grantInOriginalTab);
        const submit = (session: typeof copiedSession) => withTransactionLock(async () => {
            if (!session.approved || persistentSpent) return "spent";
            await Promise.resolve(); // Proof construction may suspend.
            persistentSpent = true; // Native Tokens seals before the RPC.
            publicationAttempts++;
            throw new Error("unknown RPC result");
        });
        const results = await Promise.allSettled([submit(grantInOriginalTab), submit(copiedSession)]);
        expect(results[0].status).toBe("rejected");
        expect(results[1]).toEqual({ status: "fulfilled", value: "spent" });
        expect(publicationAttempts).toBe(1);
    });

    it("releases on a prompt or signing rejection before a later context starts", async () => {
        vi.stubGlobal("navigator", { locks: sharedLockManager() });
        await expect(withTransactionLock(async () => { throw new Error("user_prompt_request"); })).rejects.toThrow("user_prompt_request");
        await expect(withTransactionLock(async () => "next context")).resolves.toBe("next context");
    });

    it("fails closed without Web Locks and never executes the native context", async () => {
        vi.stubGlobal("navigator", {});
        const run = vi.fn(async () => "unsafe fallback");
        await expect(withTransactionLock(run)).rejects.toThrow("requires Web Locks");
        expect(run).not.toHaveBeenCalled();
    });
});
