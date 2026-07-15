import type { PeerMediaPort } from "../transport/peer-media-port";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSharedMeetPeer } from "./shared-meet-peer";

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

function createMockMediaPort(
    peer: ReturnType<typeof createMockChatPeer> | null,
): PeerMediaPort {
    return {
        ensure: vi.fn(async () => {}),
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
        const media = createMockMediaPort(chatPeer);
        const peer = createSharedMeetPeer(media, {
            remoteAccount: "bob",
            avCallSessionId: "wrtc:space-1",
            wantVideo: true,
            wantAudio: true,
        });

        await peer.start();

        expect(media.ensure).toHaveBeenCalledWith("bob", "meet_start");
        expect(media.holdMeet).toHaveBeenCalledWith("bob");
        expect(chatPeer.startMeetMedia).toHaveBeenCalled();

        peer.dispose();

        expect(chatPeer.stopMeetMedia).toHaveBeenCalled();
        expect(media.releaseMeet).toHaveBeenCalledWith("bob");
        expect(peer.isDisposed).toBe(true);
    });

    it("does not close the underlying chat peer on dispose", async () => {
        const chatPeer = createMockChatPeer();
        const media = createMockMediaPort(chatPeer);
        const peer = createSharedMeetPeer(media, {
            remoteAccount: "bob",
            avCallSessionId: "wrtc:space-1",
            wantVideo: false,
            wantAudio: true,
        });

        await peer.start();
        peer.dispose();

        // Media port has no dispose — SharedMeetPeer must not tear down the PC.
        expect(media.releaseMeet).toHaveBeenCalledWith("bob");
    });

    it("start rejects cleanly when ensure rejects (no hang)", async () => {
        const media = createMockMediaPort(null);
        (media.ensure as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error("ensure timed out for bob"),
        );
        const onFailed = vi.fn();
        const peer = createSharedMeetPeer(media, {
            remoteAccount: "bob",
            avCallSessionId: "wrtc:space-1",
            wantVideo: true,
            wantAudio: true,
            onFailed,
        });

        await expect(peer.start()).rejects.toThrow(/ensure timed out for bob/);
        expect(media.holdMeet).not.toHaveBeenCalled();
        expect(media.releaseMeet).not.toHaveBeenCalled();
        expect(peer.isDisposed).toBe(false);
    });

    it("start fails cleanly when ensure resolves but peer is missing", async () => {
        const media = createMockMediaPort(null);
        const onFailed = vi.fn();
        const peer = createSharedMeetPeer(media, {
            remoteAccount: "bob",
            avCallSessionId: "wrtc:space-1",
            wantVideo: true,
            wantAudio: true,
            onFailed,
        });

        await peer.start();

        expect(media.ensure).toHaveBeenCalledWith("bob", "meet_start");
        expect(onFailed).toHaveBeenCalledWith(
            "Shared pair PC not ready for Meet",
        );
        expect(media.holdMeet).not.toHaveBeenCalled();
        expect(peer.isDisposed).toBe(false);
    });
});
