import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { AvCallDmWebRtcPeer } from "./av-call-dm-peer";
import { MeetWebRtcPeer } from "./meet-webrtc-peer";
import type { IceServerConfig } from "./protocol";
import type { WebRtcSignalingClient } from "./webrtc-signaling-client";

const buildRtcPeerConnectionConfigMock = vi.hoisted(() =>
    vi.fn((servers: IceServerConfig[] | null) => ({
        iceServers: servers ?? [],
    })),
);

const rtcPeerConnectionConfigs: RTCConfiguration[] = [];

vi.mock("./ice-config", () => ({
    buildRtcPeerConnectionConfig: buildRtcPeerConnectionConfigMock,
}));

vi.mock("./local-media", () => ({
    acquireMeetLocalMedia: vi.fn(async () => ({
        stream: {
            getTracks: () => [],
            getAudioTracks: () => [],
            getVideoTracks: () => [],
        } as unknown as MediaStream,
        videoDisabled: false,
    })),
}));

vi.mock("./av-call-debug", () => ({
    avCallLog: () => {},
    avCallRecord: () => {},
    shortSessionId: (id: string) => id,
}));

vi.mock("./webrtc-local-dev-ice", () => ({
    isLocalDevWebRtcEnvironment: () => false,
    normalizeIceCandidateForEnvironment: (c: string | undefined) => c ?? "",
}));

beforeEach(() => {
    buildRtcPeerConnectionConfigMock.mockClear();
    rtcPeerConnectionConfigs.length = 0;
    vi.stubGlobal(
        "RTCPeerConnection",
        class {
            iceConnectionState = "new";

            connectionState = "new";

            signalingState = "stable";

            constructor(config: RTCConfiguration) {
                rtcPeerConnectionConfigs.push(config);
            }

            addTrack = vi.fn();

            close = vi.fn();

            createOffer = vi.fn(async () => ({ sdp: "v=0", type: "offer" }));

            setLocalDescription = vi.fn(async () => {});

            set onicecandidate(_handler: (ev: { candidate: null }) => void) {}

            set ontrack(_handler: unknown) {}

            set oniceconnectionstatechange(_handler: unknown) {}

            set onconnectionstatechange(_handler: unknown) {}
        },
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function mockSignaling(): WebRtcSignalingClient {
    return {
        signal: vi.fn(),
        joinSession: vi.fn(),
        leaveSession: vi.fn(),
        participantState: vi.fn(),
    } as unknown as WebRtcSignalingClient;
}

describe("MeetWebRtcPeer", () => {
    it("keeps AvCallDmWebRtcPeer as a deprecated alias until T-054 cutover", () => {
        expect(AvCallDmWebRtcPeer).toBe(MeetWebRtcPeer);
    });

    it("ignores remote signals from non-peer accounts", async () => {
        const signaling = mockSignaling();
        const peer = new MeetWebRtcPeer({
            sessionId: "sess-1",
            selfAccount: "alice",
            peerAccount: "bob",
            iceServers: null,
            signaling,
            isInitiator: false,
            wantVideo: true,
            wantAudio: true,
        });

        await peer.handleRemoteSignal({
            from: "carol",
            kind: "offer",
            sdp: "v=0",
        });

        expect(signaling.signal).not.toHaveBeenCalled();
        peer.dispose();
    });

    it("dispose marks peer as disposed", () => {
        const peer = new MeetWebRtcPeer({
            sessionId: "sess-2",
            selfAccount: "alice",
            peerAccount: "bob",
            iceServers: null,
            signaling: mockSignaling(),
            isInitiator: true,
            wantVideo: false,
            wantAudio: true,
        });

        expect(peer.isDisposed).toBe(false);
        peer.dispose();
        expect(peer.isDisposed).toBe(true);
    });

    it("builds RTCPeerConnection from welcome iceServers via ice-config", async () => {
        const turnWelcome: IceServerConfig[] = [
            {
                urls: "turn:turn.example.com:3478",
                username: "user",
                credential: "pass",
            },
        ];
        const peer = new MeetWebRtcPeer({
            sessionId: "sess-ice",
            selfAccount: "alice",
            peerAccount: "bob",
            iceServers: turnWelcome,
            signaling: mockSignaling(),
            isInitiator: true,
            wantVideo: true,
            wantAudio: true,
        });

        await peer.start();

        expect(buildRtcPeerConnectionConfigMock).toHaveBeenCalledWith(
            turnWelcome,
        );
        expect(rtcPeerConnectionConfigs[0]).toEqual({
            iceServers: turnWelcome,
        });
        peer.dispose();
    });
});
