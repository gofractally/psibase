import { describe, expect, it, vi } from "vitest";

import type { AvCallOrchestratorHost } from "./av-call-session-types";
import { createMeetPeerForRemote } from "./av-call-meet-peer-factory";

describe("createMeetPeerForRemote", () => {
    it("throws without DeliveryFabric or PeerMediaPort", () => {
        const host = {
            getDeliveryFabric: () => null,
            getPeerMediaPort: () => null,
        } as unknown as AvCallOrchestratorHost;

        expect(() =>
            createMeetPeerForRemote({
                host,
                remoteAccount: "bob",
                avCallSessionId: "wrtc:space-1",
                selfAccount: "alice",
                isInitiator: true,
                wantVideo: true,
                wantAudio: true,
            }),
        ).toThrow(/DeliveryFabric \(or PeerMediaPort\) required/);
    });

    it("uses DeliveryFabric.startPeerMedia when fabric is present", () => {
        const handle = { sessionId: "wrtc:space-1", isDisposed: false };
        const startPeerMedia = vi.fn(() => handle);
        const host = {
            getDeliveryFabric: () => ({ startPeerMedia }),
            getPeerMediaPort: () => null,
        } as unknown as AvCallOrchestratorHost;

        const peer = createMeetPeerForRemote({
            host,
            remoteAccount: "bob",
            avCallSessionId: "wrtc:space-1",
            selfAccount: "alice",
            isInitiator: true,
            wantVideo: false,
            wantAudio: true,
        });

        expect(startPeerMedia).toHaveBeenCalledWith(
            expect.objectContaining({
                remoteAccount: "bob",
                avCallSessionId: "wrtc:space-1",
                wantVideo: false,
                wantAudio: true,
            }),
        );
        expect(peer).toBe(handle);
    });
});
