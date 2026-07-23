import { vi } from "vitest";

vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { depsFor: null } }),
        arrayBuffer: async () => new ArrayBuffer(0),
    })),
);
