import { vi } from "vitest";

import { installUint8ArrayBase64Polyfill } from "./uint8array-base64-polyfill";

installUint8ArrayBase64Polyfill();

vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { depsFor: null } }),
        arrayBuffer: async () => new ArrayBuffer(0),
    })),
);
