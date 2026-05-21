import { describe, expect, it } from "vitest";

import {
    resolveCatchUpMode,
    shouldForcePendingFlushOnConnect,
    shouldPushHistoryOnConnect,
} from "./catch-up-policy";

describe("resolveCatchUpMode", () => {
    it("late joiner when peer was offline at session start", () => {
        expect(
            resolveCatchUpMode({
                peerWasOnlineAtSessionStart: false,
                peerIsOnlineNow: true,
                hadOpenDataChannel: false,
            }),
        ).toEqual({ kind: "lateJoiner" });
    });

    it("returning member when peer was online at start, left, and reconnected", () => {
        expect(
            resolveCatchUpMode({
                peerWasOnlineAtSessionStart: true,
                peerIsOnlineNow: true,
                hadOpenDataChannel: true,
            }),
        ).toEqual({ kind: "returningMember" });
    });

    it("active when peer was online at start and never had an open channel yet", () => {
        expect(
            resolveCatchUpMode({
                peerWasOnlineAtSessionStart: true,
                peerIsOnlineNow: true,
                hadOpenDataChannel: false,
            }),
        ).toEqual({ kind: "active" });
    });
});

describe("shouldPushHistoryOnConnect", () => {
    it("pushes for late joiners and returning members", () => {
        expect(
            shouldPushHistoryOnConnect({
                peerWasOnlineAtSessionStart: false,
                peerIsOnlineNow: true,
                hadOpenDataChannel: false,
            }),
        ).toBe(true);
        expect(
            shouldPushHistoryOnConnect({
                peerWasOnlineAtSessionStart: true,
                peerIsOnlineNow: true,
                hadOpenDataChannel: true,
            }),
        ).toBe(true);
        expect(
            shouldPushHistoryOnConnect({
                peerWasOnlineAtSessionStart: true,
                peerIsOnlineNow: true,
                hadOpenDataChannel: false,
            }),
        ).toBe(false);
    });
});

describe("shouldForcePendingFlushOnConnect", () => {
    it("forces flush for late joiners and returning members", () => {
        expect(
            shouldForcePendingFlushOnConnect({
                peerWasOnlineAtSessionStart: false,
                peerIsOnlineNow: true,
                hadOpenDataChannel: false,
            }),
        ).toBe(true);
        expect(
            shouldForcePendingFlushOnConnect({
                peerWasOnlineAtSessionStart: true,
                peerIsOnlineNow: true,
                hadOpenDataChannel: true,
            }),
        ).toBe(true);
        expect(
            shouldForcePendingFlushOnConnect({
                peerWasOnlineAtSessionStart: true,
                peerIsOnlineNow: true,
                hadOpenDataChannel: false,
            }),
        ).toBe(false);
    });
});
