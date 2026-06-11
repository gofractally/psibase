import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PEER_ESTABLISHING_STUCK_MS } from "./types";
import {
    createRosterRenegotiationCoordinator,
    type PeerRosterSnapshot,
} from "./roster-renegotiation-coordinator";

describe("roster-renegotiation-coordinator", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const flushDebounce = async () => {
        await vi.advanceTimersByTimeAsync(150);
    };

    it("coalesces rapid notifications into one decision", async () => {
        const ensure = vi.fn();
        const coordinator = createRosterRenegotiationCoordinator({
            localAccount: "alice",
            pairIdForRemote: (remote) => `wrtc:pair:alice:${remote}`,
            remoteForPairId: () => "bob",
            getSnapshot: () => null,
            actions: {
                ensure,
                resendOffer: vi.fn(),
                retriggerHandshake: vi.fn(),
                recoverPeer: vi.fn(),
            },
            debounceMs: 150,
        });

        coordinator.notifyRemoteReachable("bob", "presence_online");
        coordinator.notifyRemoteReachable("bob", "presence_online");
        coordinator.notifyRemoteReachable("bob", "peer_joined");
        expect(ensure).not.toHaveBeenCalled();

        await flushDebounce();
        expect(ensure).toHaveBeenCalledTimes(1);
        expect(ensure).toHaveBeenCalledWith("bob", "peer_joined");
    });

    it("does not retrigger join when polite side is negotiating in window", async () => {
        const resendOffer = vi.fn();
        const retriggerHandshake = vi.fn();
        const snap: PeerRosterSnapshot = {
            remote: "bob",
            state: "negotiating",
            negotiationStartedAt: 1000,
            isJoined: true,
            isInitiator: false,
            hasPeer: true,
        };
        const coordinator = createRosterRenegotiationCoordinator({
            localAccount: "alice",
            pairIdForRemote: (remote) => `wrtc:pair:alice:${remote}`,
            remoteForPairId: () => "bob",
            getSnapshot: () => snap,
            actions: {
                ensure: vi.fn(),
                resendOffer,
                retriggerHandshake,
                recoverPeer: vi.fn(),
            },
            debounceMs: 0,
            now: () => 2000,
        });

        coordinator.notifyPairRosterUpdate("bob", "roster_kick");
        await vi.advanceTimersByTimeAsync(0);
        expect(resendOffer).not.toHaveBeenCalled();
        expect(retriggerHandshake).not.toHaveBeenCalled();
    });

    it("resends offer once for impolite negotiating peer in window", async () => {
        const resendOffer = vi.fn();
        const snap: PeerRosterSnapshot = {
            remote: "bob",
            state: "negotiating",
            negotiationStartedAt: 1000,
            isJoined: true,
            isInitiator: true,
            hasPeer: true,
        };
        const coordinator = createRosterRenegotiationCoordinator({
            localAccount: "alice",
            pairIdForRemote: (remote) => `wrtc:pair:alice:${remote}`,
            remoteForPairId: () => "bob",
            getSnapshot: () => snap,
            actions: {
                ensure: vi.fn(),
                resendOffer,
                retriggerHandshake: vi.fn(),
                recoverPeer: vi.fn(),
            },
            debounceMs: 0,
            now: () => 2000,
        });

        coordinator.notifyPairRosterUpdate("bob", "peer_joined");
        await vi.advanceTimersByTimeAsync(0);
        expect(resendOffer).toHaveBeenCalledTimes(1);
    });

    it("retrigger handshake when joined without peer", async () => {
        const retriggerHandshake = vi.fn();
        const snap: PeerRosterSnapshot = {
            remote: "bob",
            state: "absent",
            negotiationStartedAt: null,
            isJoined: true,
            isInitiator: false,
            hasPeer: false,
        };
        const coordinator = createRosterRenegotiationCoordinator({
            localAccount: "alice",
            pairIdForRemote: (remote) => `wrtc:pair:alice:${remote}`,
            remoteForPairId: () => "bob",
            getSnapshot: () => snap,
            actions: {
                ensure: vi.fn(),
                resendOffer: vi.fn(),
                retriggerHandshake,
                recoverPeer: vi.fn(),
            },
            debounceMs: 0,
        });

        coordinator.notifyPairRosterUpdate("bob", "roster_kick");
        await vi.advanceTimersByTimeAsync(0);
        expect(retriggerHandshake).toHaveBeenCalledWith("bob");
    });

    it("recovers peer when negotiation exceeds establishing window", async () => {
        const recoverPeer = vi.fn();
        const snap: PeerRosterSnapshot = {
            remote: "bob",
            state: "negotiating",
            negotiationStartedAt: 0,
            isJoined: true,
            isInitiator: true,
            hasPeer: true,
        };
        const coordinator = createRosterRenegotiationCoordinator({
            localAccount: "alice",
            pairIdForRemote: (remote) => `wrtc:pair:alice:${remote}`,
            remoteForPairId: () => "bob",
            getSnapshot: () => snap,
            actions: {
                ensure: vi.fn(),
                resendOffer: vi.fn(),
                retriggerHandshake: vi.fn(),
                recoverPeer,
            },
            debounceMs: 0,
            now: () => PEER_ESTABLISHING_STUCK_MS + 1,
        });

        coordinator.notifyPairRosterUpdate("bob", "roster_kick");
        await vi.advanceTimersByTimeAsync(0);
        expect(recoverPeer).toHaveBeenCalledWith(
            "bob",
            "roster-coordinator-stuck",
        );
    });

    it("notifyJoinBatchIdle targets only the completed pair remote", async () => {
        const ensure = vi.fn();
        const coordinator = createRosterRenegotiationCoordinator({
            localAccount: "alice",
            pairIdForRemote: (remote) => `wrtc:pair:alice:${remote}`,
            remoteForPairId: (pairId) =>
                pairId === "wrtc:pair:alice:bob" ? "bob" : null,
            getSnapshot: () => null,
            actions: {
                ensure,
                resendOffer: vi.fn(),
                retriggerHandshake: vi.fn(),
                recoverPeer: vi.fn(),
            },
            debounceMs: 0,
        });

        coordinator.notifyJoinBatchIdle("wrtc:pair:alice:bob");
        await vi.advanceTimersByTimeAsync(0);
        expect(ensure).toHaveBeenCalledWith("bob", "roster_kick");
    });
});
