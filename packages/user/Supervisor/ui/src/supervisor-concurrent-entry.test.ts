import { isPluginErrorObject } from "@psibase/common-lib/messaging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CALL_SENTINEL } from "@/test/test-plugin";
import {
    createTestSupervisor,
    mockAppCallArgs,
    mockAppPluginId,
    mockParentReplies,
    TEST_ORIGIN,
} from "@/test/supervisor-test-harness";

vi.mock("./plugin/plugin-loader", () => ({
    PluginLoader: class {
        trackPlugins() {}
        async processPlugins() {}
        async awaitReady() {}
    },
}));

vi.mock("./utils", () => ({
    networkNamePromise: Promise.resolve("network"),
    chainIdPromise: Promise.resolve("chain-id"),
    networkName: "network",
    chainId: "chain-id",
    isEmbedded: false,
    setQueryToken: vi.fn(),
    serviceFromOrigin: () => "homepage",
    parser: () => Promise.resolve({ parse: () => ({}) }),
    assert: (condition: unknown, errorMessage: string) => {
        if (!condition) {
            throw new Error(errorMessage);
        }
    },
    wasmFromUrl: vi.fn(),
}));

describe("Supervisor concurrent entry", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.location.href = TEST_ORIGIN;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("sequential entries both succeed", async () => {
        const replies = mockParentReplies();
        const supervisor = createTestSupervisor();
        const args = mockAppCallArgs();

        await supervisor.entry(TEST_ORIGIN, "id-1", args);
        await supervisor.entry(TEST_ORIGIN, "id-2", args);

        expect(replies.get("id-1")).toBe(CALL_SENTINEL);
        expect(replies.get("id-2")).toBe(CALL_SENTINEL);
    });

    it("concurrent entries both succeed", async () => {
        const replies = mockParentReplies();
        const supervisor = createTestSupervisor();
        const args = mockAppCallArgs();

        await Promise.all([
            supervisor.entry(TEST_ORIGIN, "id-a", args),
            supervisor.entry(TEST_ORIGIN, "id-b", args),
        ]);

        expect(replies.get("id-a")).toBe(CALL_SENTINEL);
        expect(replies.get("id-b")).toBe(CALL_SENTINEL);
        expect(isPluginErrorObject(replies.get("id-a"))).toBe(false);
        expect(isPluginErrorObject(replies.get("id-b"))).toBe(false);
    });

    it("concurrent preloadPlugins and entry both succeed", async () => {
        const replies = mockParentReplies();
        const supervisor = createTestSupervisor();
        const args = mockAppCallArgs();

        await Promise.all([
            supervisor.preloadPlugins(TEST_ORIGIN, [mockAppPluginId()]),
            supervisor.entry(TEST_ORIGIN, "id-entry", args),
        ]);

        expect(replies.get("id-entry")).toBe(CALL_SENTINEL);
        expect(isPluginErrorObject(replies.get("id-entry"))).toBe(false);
    });
});
