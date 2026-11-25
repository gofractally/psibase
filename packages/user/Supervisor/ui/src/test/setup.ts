import { vi } from "vitest";

vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { depsFor: null } }),
        arrayBuffer: async () => new ArrayBuffer(0),
    })),
);

// Baseline Supervisor tests run in happy-dom, which has no browser lock manager.
// Dedicated transaction-lock tests below exercise queueing and failure paths.
Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
} });
