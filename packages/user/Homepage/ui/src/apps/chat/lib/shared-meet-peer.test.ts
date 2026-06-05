import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSharedMeetPeer } from "./shared-meet-peer";
import type { PeerTransportRegistry } from "../transport-v2/l3-peer-registry";

function createMockChatPeer() {
    return {
        isMediaConnected: false,
        startMeetMedia: vi.fn(async () => {}),
        stopMeetMedia: vi.fn(),
        resendOffer: vi.fn(),
        getMeetLocalStream: vi.fn(() => null),
        getMeetRemoteStream: vi.fn(() => null),
        getMeetVideoActuallyDisabled: vi.fn(() => false),
        setMeetAudioEnabled: vi.fn(),
        setMeetVideoEnabled: vi.fn(),
    };
}

function createMockRegistry(
    peer: ReturnType<typeof createMockChatPeer> | null,
): PeerTransportRegistry {
    return {
        ensure: vi.fn(async () => {}),
        getState: vi.fn(() => "usable" as const),
        send: vi.fn(() => ({ ok: false, reason: "peer_not_ready" as const })),
        on: vi.fn(() => () => {}),
        ping: vi.fn(async () => true),
        touch: vi.fn(),
        dispose: vi.fn(),
        handleRemoteSignal: vi.fn(async () => {}),
        getChatPeer: vi.fn(() => peer as never),
        holdMeet: vi.fn(),
        releaseMeet: vi.fn(),
    };
}

describe("SharedMeetPeer", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("adds Meet media on the pair PC and releases hold on dispose", async () => {
        const chatPeer = createMockChatPeer();
        const registry = createMockRegistry(chatPeer);
        const peer = createSharedMeetPeer(registry, {
            remoteAccount: "bob",
            avCallSessionId: "wrtc:space-1",
            wantVideo: true,
            wantAudio: true,
        });

        await peer.start();

        expect(registry.ensure).toHaveBeenCalledWith("bob", "meet_start");
        expect(registry.holdMeet).toHaveBeenCalledWith("bob");
        expect(chatPeer.startMeetMedia).toHaveBeenCalled();

        peer.dispose();

        expect(chatPeer.stopMeetMedia).toHaveBeenCalled();
        expect(registry.releaseMeet).toHaveBeenCalledWith("bob");
        expect(peer.isDisposed).toBe(true);
    });

    it("does not close the underlying chat peer on dispose", async () => {
        const chatPeer = createMockChatPeer();
        const registry = createMockRegistry(chatPeer);
        const peer = createSharedMeetPeer(registry, {
            remoteAccount: "bob",
            avCallSessionId: "wrtc:space-1",
            wantVideo: false,
            wantAudio: true,
        });

        await peer.start();
        peer.dispose();

        expect(registry.dispose).not.toHaveBeenCalled();
    });
});
