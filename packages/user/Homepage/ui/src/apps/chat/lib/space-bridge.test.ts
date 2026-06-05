import { describe, expect, it } from "vitest";

import {
    canonicalSpaceMembers,
    deriveSpaceUuidForCanonicalMembers,
} from "./space-bridge";

describe("deriveSpaceUuidForCanonicalMembers", () => {
    it("matches Chat service hash for alice/bob", async () => {
        const uuid = await deriveSpaceUuidForCanonicalMembers(["bob", "alice"]);
        expect(uuid).toBe(
            "space:3bd9b7ea5ad83ec19bd3e99b985b0865d2a75d47dbf5907f5e65a5d75d4b4343",
        );
    });

    it("sorts members before hashing", () => {
        expect(canonicalSpaceMembers(["bob", "alice"])).toEqual([
            "alice",
            "bob",
        ]);
    });
});
