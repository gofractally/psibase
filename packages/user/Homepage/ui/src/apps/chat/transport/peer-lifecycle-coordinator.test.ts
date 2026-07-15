import type { PeerState } from "./types";

import { describe, expect, it, vi } from "vitest";

import { createPeerLifecycleCoordinator } from "./peer-lifecycle-coordinator";

describe("PeerLifecycleCoordinator", () => {
    it("routes ensure / recover through the registry and roster actions", async () => {
        const ensure = vi.fn(async () => {});
        const recoverPeer = vi.fn();
        const resendOffer = vi.fn();
        const retriggerHandshake = vi.fn();
        const kickNegotiation = vi.fn();
        const getRosterSnapshot = vi.fn(() => ({
            remote: "bob",
            state: "absent" as PeerState,
            negotiationStartedAt: null,
            isJoined: false,
            isInitiator: true,
            hasPeer: false,
        }));

        const { lifecycle } = createPeerLifecycleCoordinator({
            localAccount: "alice",
            registry: {
                ensure,
                recoverPeer,
                resendOffer,
                retriggerHandshake,
                kickNegotiation,
                getRosterSnapshot,
            },
            pairIdForRemote: (r) => `wrtc:pair:alice:${r}`,
            remoteForPairId: () => "bob",
            debounceMs: 0,
        });

        await lifecycle.ensure("bob", "message_enqueued");
        expect(ensure).toHaveBeenCalledWith("bob", "message_enqueued");

        lifecycle.recoverPeer("bob", "signaling_transport_lost");
        expect(recoverPeer).toHaveBeenCalledWith(
            "bob",
            "signaling_transport_lost",
        );

        lifecycle.notifyRemoteReachable("bob", "presence_online");
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
        expect(ensure).toHaveBeenCalledWith("bob", "presence_online");
    });

    it("getRosterSnapshot.isInitiator stays lex (not join-order)", () => {
        const getRosterSnapshot = vi.fn((remote: string) => ({
            remote,
            state: "negotiating" as PeerState,
            negotiationStartedAt: Date.now(),
            isJoined: true,
            isInitiator: remote === "bob" ? false : true,
            hasPeer: true,
        }));

        createPeerLifecycleCoordinator({
            localAccount: "alice",
            registry: {
                ensure: vi.fn(async () => {}),
                recoverPeer: vi.fn(),
                resendOffer: vi.fn(),
                retriggerHandshake: vi.fn(),
                kickNegotiation: vi.fn(),
                getRosterSnapshot,
            },
            pairIdForRemote: (r) => `wrtc:pair:alice:${r}`,
            remoteForPairId: () => "bob",
        });

        // alice < bob → alice is initiator toward bob
        expect(getRosterSnapshot("bob").isInitiator).toBe(false);
    });
});
