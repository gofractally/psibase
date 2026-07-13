import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatDataWebRtcPeer } from "./chat-data-webrtc-peer";
import { buildRtcPeerConnectionConfig } from "./ice-config";
import type { IceServerConfig } from "./protocol";
import type { WebRtcSignalingClient } from "./webrtc-signaling-client";

/** Mirrors x-wrtcsig welcome payload (STUN only, no TURN). */
const STUN_ONLY_WELCOME: IceServerConfig[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
];

const TURN_WELCOME: IceServerConfig[] = [
    { urls: "stun:stun.l.google.com:19302" },
    {
        urls: "turn:turn.example.com:3478",
        username: "user",
        credential: "pass",
    },
];

describe("buildRtcPeerConnectionConfig", () => {
    it("uses host-only ICE when welcome config is STUN-only (no TURN)", () => {
        const cfg = buildRtcPeerConnectionConfig(STUN_ONLY_WELCOME);
        expect(cfg.iceServers).toEqual([]);
    });

    it("uses host-only ICE when servers are null (fallback STUN has no TURN)", () => {
        const cfg = buildRtcPeerConnectionConfig(null);
        expect(cfg.iceServers).toEqual([]);
    });

    it("keeps TURN servers when present in welcome config", () => {
        const cfg = buildRtcPeerConnectionConfig(TURN_WELCOME);
        expect(cfg.iceServers).toHaveLength(2);
        const urls = cfg.iceServers!.flatMap((s) =>
            typeof s.urls === "string" ? [s.urls] : s.urls,
        );
        expect(urls).toContain("stun:stun.l.google.com:19302");
        expect(urls).toContain("turn:turn.example.com:3478");
    });

    it("treats turns: URLs as TURN (not host-only)", () => {
        const cfg = buildRtcPeerConnectionConfig([
            { urls: "turns:turn.example.com:5349", username: "u", credential: "p" },
        ]);
        expect(cfg.iceServers).toHaveLength(1);
        expect(cfg.iceServers![0]!.urls).toBe("turns:turn.example.com:5349");
    });
});

/**
 * Mock RTCPeerConnection with controllable async setLocalDescription /
 * setRemoteDescription so tests can exercise the
 * createOffer-vs-resendOffer race (see {@link ChatDataWebRtcPeer.offerInFlight})
 * and the stale-answer-in-stable-state guard.
 */
class FakePeerConnection {
    static instances: FakePeerConnection[] = [];

    iceConnectionState = "new";

    connectionState = "new";

    iceGatheringState = "new";

    /** Mutable so tests can drive it through realistic transitions. */
    signalingState: RTCSignalingState = "stable";

    receivers: Array<{ track: MediaStreamTrack | null }> = [];

    senders: Array<{ track: MediaStreamTrack | null }> = [];

    getReceivers = vi.fn(() => this.receivers as RTCRtpReceiver[]);

    getSenders = vi.fn(() => this.senders as RTCRtpSender[]);

    removeTrack = vi.fn((sender: RTCRtpSender) => {
        this.senders = this.senders.filter((s) => s !== sender);
    });

    localDescription: RTCSessionDescription | null = null;

    remoteDescription: RTCSessionDescription | null = null;

    /** Outstanding setLocalDescription deferreds, keyed by call order. */
    static pendingSetLocal: Array<() => void> = [];

    static pendingSetRemote: Array<() => void> = [];

    static reset() {
        FakePeerConnection.pendingSetLocal = [];
        FakePeerConnection.pendingSetRemote = [];
        FakePeerConnection.instances = [];
    }

    constructor(_config?: RTCConfiguration) {
        FakePeerConnection.instances.push(this);
    }

    addTrack = vi.fn();

    addTransceiver = vi.fn(() => ({}) as RTCRtpTransceiver);

    close = vi.fn();

    private negotiationNeededHandler: (() => void) | null = null;

    createDataChannel = vi.fn(() => {
        // Real RTCPeerConnection fires `negotiationneeded` asynchronously
        // after `createDataChannel` (the data channel adds an m-section
        // that requires negotiation). Mimic that so the Perfect
        // Negotiation entrypoint is exercised in tests.
        queueMicrotask(() => this.negotiationNeededHandler?.());
        return {
            onopen: null,
            onclose: null,
            onerror: null,
            onmessage: null,
            readyState: "connecting",
            send: vi.fn(),
            close: vi.fn(),
        } as unknown as RTCDataChannel;
    });

    restartIce = vi.fn(() => {
        // restartIce also schedules a renegotiation.
        queueMicrotask(() => this.negotiationNeededHandler?.());
    });

    createOffer = vi.fn(
        async () => ({ sdp: "v=0 offer-sdp", type: "offer" }) as RTCSessionDescriptionInit,
    );

    createAnswer = vi.fn(
        async () => ({ sdp: "v=0 answer-sdp", type: "answer" }) as RTCSessionDescriptionInit,
    );

    setLocalDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
        await new Promise<void>((resolve) => {
            FakePeerConnection.pendingSetLocal.push(resolve);
        });
        this.localDescription = desc as RTCSessionDescription;
        if (desc.type === "offer") this.signalingState = "have-local-offer";
        else if (desc.type === "answer") this.signalingState = "stable";
    });

    setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
        await new Promise<void>((resolve) => {
            FakePeerConnection.pendingSetRemote.push(resolve);
        });
        this.remoteDescription = desc as RTCSessionDescription;
        if (desc.type === "offer") this.signalingState = "have-remote-offer";
        else if (desc.type === "answer") this.signalingState = "stable";
    });

    addIceCandidate = vi.fn(async (_init: RTCIceCandidateInit | null) => {});

    set onicecandidate(_handler: unknown) {}

    set ontrack(_handler: unknown) {}

    set ondatachannel(_handler: unknown) {}

    set oniceconnectionstatechange(_handler: unknown) {}

    set onconnectionstatechange(_handler: unknown) {}

    set onicegatheringstatechange(_handler: unknown) {}

    set onsignalingstatechange(_handler: unknown) {}

    set onnegotiationneeded(handler: (() => void) | null) {
        this.negotiationNeededHandler = handler;
    }
}

/** Drain microtasks until at least one resolver lands in `bucket`, then resolve them all. */
async function drainPendingDeferred(bucket: Array<() => void>): Promise<void> {
    for (let i = 0; i < 50 && bucket.length === 0; i++) {
        await Promise.resolve();
    }
    for (const r of bucket.splice(0)) r();
    await Promise.resolve();
    await Promise.resolve();
}

function mockSignaling(): WebRtcSignalingClient {
    return {
        signal: vi.fn(),
        joinSession: vi.fn(),
        leaveSession: vi.fn(),
        participantState: vi.fn(),
    } as unknown as WebRtcSignalingClient;
}

vi.mock("./chat-data-debug", () => ({
    chatDataLog: () => {},
    chatDataRecord: () => {},
    logIceCandidate: () => {},
    registerChatDataPeer: () => {},
    unregisterChatDataPeer: () => {},
    shortSessionId: (id: string) => id,
    summarizePeerConnection: async () => ({}),
}));

vi.mock("./webrtc-local-dev-ice", () => ({
    isLocalDevWebRtcEnvironment: () => false,
    normalizeIceCandidateForEnvironment: (c: string | undefined) => c ?? "",
}));

vi.mock("./local-media", () => ({
    acquireMeetLocalMedia: vi.fn(async () => {
        const audioTrack = {
            kind: "audio",
            enabled: true,
            readyState: "live",
        } as MediaStreamTrack;
        const videoTrack = {
            kind: "video",
            enabled: true,
            readyState: "live",
        } as MediaStreamTrack;
        return {
            stream: {
                getAudioTracks: () => [audioTrack],
                getVideoTracks: () => [videoTrack],
                getTracks: () => [audioTrack, videoTrack],
            } as unknown as MediaStream,
            videoDisabled: false,
        };
    }),
}));

beforeEach(() => {
    FakePeerConnection.reset();
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    vi.stubGlobal(
        "RTCIceCandidate",
        class {
            constructor(public init: RTCIceCandidateInit) {}
        },
    );
    vi.stubGlobal(
        "MediaStream",
        class MockMediaStream {
            constructor(private readonly tracks: MediaStreamTrack[]) {}
            getTracks(): MediaStreamTrack[] {
                return this.tracks;
            }
            getAudioTracks(): MediaStreamTrack[] {
                return this.tracks.filter((t) => t.kind === "audio");
            }
            getVideoTracks(): MediaStreamTrack[] {
                return this.tracks.filter((t) => t.kind === "video");
            }
        },
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
});

/**
 * Reproduces the race seen in production logs (alicealice rejoining a
 * 3-party group): a `participantJoined` event arrives in the same microtask
 * as the initial `createAndSendOffer`, calling `resendOffer()` while
 * `setLocalDescription` is still in flight. Without the `offerInFlight`
 * guard the second offer ships, the remote answers it with a second answer,
 * and `setRemoteDescription("answer")` lands on a `stable` PC →
 * `Failed to execute 'setRemoteDescription' on 'RTCPeerConnection': Called
 * in wrong state: stable`.
 */
describe("ChatDataWebRtcPeer offer race", () => {
    it("resendOffer is a no-op while the initial offer is still in flight", async () => {
        const signaling = mockSignaling();
        const peer = new ChatDataWebRtcPeer({
            sessionId: "sess-glare",
            selfAccount: "alicealice",
            peerAccount: "daviddavid",
            iceServers: null,
            signaling,
            isInitiator: true,
        });

        // Microtask drain: createOffer resolves and setLocalDescription is
        // now suspended on its pending deferred. signalingState is still
        // "stable" because the await hasn't completed.
        await Promise.resolve();
        await Promise.resolve();
        expect(FakePeerConnection.pendingSetLocal.length).toBe(1);

        // The orchestrator's `participantJoined` event arrives in this same
        // turn, calling `resendOffer()` while the initial offer's
        // setLocalDescription is still pending. Without the offerInFlight
        // guard a second offer would race the first.
        peer.resendOffer();
        peer.resendOffer();

        // Drain the in-flight setLocalDescription so the initial offer
        // finalizes cleanly.
        for (const r of FakePeerConnection.pendingSetLocal.splice(0)) r();
        await Promise.resolve();
        await Promise.resolve();

        const offerCalls = (
            signaling.signal as ReturnType<typeof vi.fn>
        ).mock.calls.filter((c) => c[0].kind === "offer");
        expect(offerCalls.length).toBe(1);

        peer.dispose();
    });

    it("resendOffer retransmits local SDP when signalingState is have-local-offer", async () => {
        const signaling = mockSignaling();
        const peer = new ChatDataWebRtcPeer({
            sessionId: "sess-have-local",
            selfAccount: "alicealice",
            peerAccount: "myprod",
            iceServers: null,
            signaling,
            isInitiator: true,
        });

        await drainPendingDeferred(FakePeerConnection.pendingSetLocal);

        const offersAfterInit = (
            signaling.signal as ReturnType<typeof vi.fn>
        ).mock.calls.filter((c) => c[0].kind === "offer").length;
        expect(offersAfterInit).toBe(1);

        peer.resendOffer();
        await Promise.resolve();

        const offersAfterResend = (
            signaling.signal as ReturnType<typeof vi.fn>
        ).mock.calls.filter((c) => c[0].kind === "offer").length;
        expect(offersAfterResend).toBe(2);
        expect(
            (signaling.signal as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]
                .sdp,
        ).toBe("v=0 offer-sdp");

        peer.dispose();
    });
});

/**
 * Perfect Negotiation: collision handling. When both sides happen to
 * generate offers simultaneously (e.g. a `restartIce` race during transport
 * recovery), one side's offer must win. The impolite side keeps its offer
 * and drops the incoming one; the polite side rolls back its own and
 * accepts the remote.
 */
describe("ChatDataWebRtcPeer perfect negotiation collision", () => {
    it("impolite side drops a colliding remote offer without disturbing its own", async () => {
        const signaling = mockSignaling();
        const onFailed = vi.fn();
        const peer = new ChatDataWebRtcPeer({
            sessionId: "sess-collide-impolite",
            selfAccount: "alicealice",
            peerAccount: "myprod",
            iceServers: null,
            signaling,
            isInitiator: true, // impolite
            handlers: { onFailed },
        });

        // Drive the initial offer to "have-local-offer" so the next remote
        // offer arrives mid-negotiation (collision).
        await drainPendingDeferred(FakePeerConnection.pendingSetLocal);

        const offersAfterInit = (
            signaling.signal as ReturnType<typeof vi.fn>
        ).mock.calls.filter((c) => c[0].kind === "offer").length;
        expect(offersAfterInit).toBe(1);

        // Remote sends an offer too — collision.
        await peer.handleRemoteSignal({
            from: "myprod",
            kind: "offer",
            sdp: "v=0 colliding-remote-offer",
        });

        // Impolite side keeps its offer; setRemoteDescription must not
        // have been called for the colliding offer.
        const offersStillOne = (
            signaling.signal as ReturnType<typeof vi.fn>
        ).mock.calls.filter((c) => c[0].kind === "offer").length;
        expect(offersStillOne).toBe(1);
        const answersSent = (
            signaling.signal as ReturnType<typeof vi.fn>
        ).mock.calls.filter((c) => c[0].kind === "answer").length;
        expect(answersSent).toBe(0);
        expect(onFailed).not.toHaveBeenCalled();
        expect(peer.isDisposed).toBe(false);

        peer.dispose();
    });

    it("polite side rolls back and accepts a colliding remote offer (answers it)", async () => {
        const signaling = mockSignaling();
        const onFailed = vi.fn();
        const peer = new ChatDataWebRtcPeer({
            sessionId: "sess-collide-polite",
            selfAccount: "alicealice",
            peerAccount: "myprod",
            iceServers: null,
            signaling,
            isInitiator: false, // does not open data channel / send first offer
            impolite: false, // polite side: rolls back on collision
            handlers: { onFailed },
        });

        // Force the polite side into "have-local-offer" via restartIce
        // (simulates `resendOffer` → restartIce path).
        peer.restartIce();
        await drainPendingDeferred(FakePeerConnection.pendingSetLocal);
        const offersFromPolite = (
            signaling.signal as ReturnType<typeof vi.fn>
        ).mock.calls.filter((c) => c[0].kind === "offer").length;
        expect(offersFromPolite).toBe(1);

        // Now the remote (impolite) offer collides with the polite
        // offer. The polite side must accept the remote offer.
        const incoming = peer.handleRemoteSignal({
            from: "myprod",
            kind: "offer",
            sdp: "v=0 incoming-impolite-offer",
        });
        await drainPendingDeferred(FakePeerConnection.pendingSetRemote);
        await drainPendingDeferred(FakePeerConnection.pendingSetLocal);
        await incoming;

        const answersSent = (
            signaling.signal as ReturnType<typeof vi.fn>
        ).mock.calls.filter((c) => c[0].kind === "answer");
        expect(answersSent.length).toBe(1);
        expect(answersSent[0]?.[0].sdp).toBe("v=0 answer-sdp");
        expect(onFailed).not.toHaveBeenCalled();

        peer.dispose();
    });
});

/**
 * Reproduces the second half of the regression: a stale answer arrives
 * after the PC has reached `stable`. Before the fix the peer threw, was
 * marked failed, and torn down via transport recovery. After the fix the
 * peer drops the frame and stays connected.
 */
describe("ChatDataWebRtcPeer stale-answer guard", () => {
    it("drops a remote answer applied while signalingState=stable", async () => {
        const signaling = mockSignaling();
        const onFailed = vi.fn();
        const peer = new ChatDataWebRtcPeer({
            sessionId: "sess-stale",
            selfAccount: "alicealice",
            peerAccount: "daviddavid",
            iceServers: null,
            signaling,
            isInitiator: true,
            handlers: { onFailed },
        });

        // Drain the initial offer so signalingState transitions through
        // have-local-offer → stable (after we feed the first answer).
        await drainPendingDeferred(FakePeerConnection.pendingSetLocal);

        // First answer: signalingState is "have-local-offer" so it is
        // accepted and transitions to "stable".
        const firstAnswer = peer.handleRemoteSignal({
            from: "daviddavid",
            kind: "answer",
            sdp: "v=0 first-answer",
        });
        await drainPendingDeferred(FakePeerConnection.pendingSetRemote);
        await firstAnswer;

        // Second answer (stale duplicate): PC is now stable. Pre-fix this
        // would throw inside setRemoteDescription and tear the peer down.
        await peer.handleRemoteSignal({
            from: "daviddavid",
            kind: "answer",
            sdp: "v=0 stale-answer",
        });

        expect(onFailed).not.toHaveBeenCalled();
        expect(peer.isDisposed).toBe(false);
        peer.dispose();
    });
});

describe("ChatDataWebRtcPeer stale-offer guard", () => {
    it("drops a duplicate remote offer after negotiation reached stable", async () => {
        const signaling = mockSignaling();
        const onFailed = vi.fn();
        const peer = new ChatDataWebRtcPeer({
            sessionId: "sess-stale-offer",
            selfAccount: "myprod",
            peerAccount: "alicealice",
            iceServers: null,
            signaling,
            isInitiator: false,
            impolite: true,
            handlers: { onFailed },
        });

        const firstOffer = peer.handleRemoteSignal({
            from: "alicealice",
            kind: "offer",
            sdp: "v=0 first-offer",
        });
        await drainPendingDeferred(FakePeerConnection.pendingSetRemote);
        await drainPendingDeferred(FakePeerConnection.pendingSetLocal);
        await firstOffer;

        const answersBefore = (
            signaling.signal as ReturnType<typeof vi.fn>
        ).mock.calls.filter((c) => c[0].kind === "answer").length;
        expect(answersBefore).toBe(1);

        await peer.handleRemoteSignal({
            from: "alicealice",
            kind: "offer",
            sdp: "v=0 first-offer",
        });

        const answersAfter = (
            signaling.signal as ReturnType<typeof vi.fn>
        ).mock.calls.filter((c) => c[0].kind === "answer").length;
        expect(answersAfter).toBe(1);
        expect(onFailed).not.toHaveBeenCalled();
        peer.dispose();
    });
});

describe("ChatDataWebRtcPeer needsReconnect", () => {
    function createTestPeer(isInitiator: boolean) {
        return new ChatDataWebRtcPeer({
            sessionId: "sess-reconnect",
            selfAccount: "alice",
            peerAccount: "bob",
            iceServers: null,
            signaling: mockSignaling(),
            isInitiator,
            handlers: {},
        });
    }

    function pc(): FakePeerConnection {
        return FakePeerConnection.instances.at(-1)!;
    }

    it("is false while ICE is checking after stable SDP", () => {
        const peer = createTestPeer(true);
        pc().signalingState = "stable";
        pc().connectionState = "connecting";
        pc().iceConnectionState = "checking";
        expect(peer.needsReconnect).toBe(false);
        peer.dispose();
    });

    it("is false at stable/new/new before any remote offer (polite wedge pre-timeout)", () => {
        const peer = createTestPeer(false);
        pc().signalingState = "stable";
        pc().connectionState = "new";
        pc().iceConnectionState = "new";
        expect(peer.needsReconnect).toBe(false);
        peer.dispose();
    });

    it("is true when stable with no ICE progress after handshake", () => {
        const peer = createTestPeer(false);
        pc().signalingState = "stable";
        pc().connectionState = "connected";
        pc().iceConnectionState = "connected";
        expect(peer.needsReconnect).toBe(true);
        peer.dispose();
    });

    it("is true when transport failed", () => {
        const peer = createTestPeer(true);
        pc().signalingState = "stable";
        pc().connectionState = "failed";
        pc().iceConnectionState = "failed";
        expect(peer.needsReconnect).toBe(true);
        peer.dispose();
    });
});

describe("ChatDataWebRtcPeer Meet restart remote stream", () => {
    it("rehydrates remote stream from PC receivers after stop/start", async () => {
        const signaling = mockSignaling();
        const onRemoteStream = vi.fn();
        const peer = new ChatDataWebRtcPeer({
            sessionId: "sess-meet-restart",
            selfAccount: "carol",
            peerAccount: "alice",
            iceServers: null,
            signaling,
            isInitiator: false,
        });

        const fakePc = FakePeerConnection.instances[0]!;
        fakePc.connectionState = "connected";
        const remoteTrack = {
            kind: "video",
            readyState: "live",
            enabled: true,
        } as MediaStreamTrack;
        fakePc.receivers = [{ track: remoteTrack }];
        const localStream = {
            getAudioTracks: () => [],
            getVideoTracks: () => [],
            getTracks: () => [],
        } as unknown as MediaStream;

        await peer.startMeetMedia({
            wantVideo: true,
            wantAudio: true,
            sharedLocalStream: localStream,
            onRemoteStream,
        });

        expect(onRemoteStream).toHaveBeenCalled();
        const stream = onRemoteStream.mock.calls.at(-1)?.[0] as MediaStream;
        expect(stream?.getTracks()).toContain(remoteTrack);
        expect(peer.getMeetRemoteStream()?.getTracks()).toContain(remoteTrack);

        peer.stopMeetMedia();
        expect(peer.getMeetRemoteStream()).toBeNull();

        const onRemoteStreamAfterRestart = vi.fn();
        await peer.startMeetMedia({
            wantVideo: true,
            wantAudio: true,
            sharedLocalStream: localStream,
            onRemoteStream: onRemoteStreamAfterRestart,
        });

        expect(onRemoteStreamAfterRestart).toHaveBeenCalled();
        const restarted = onRemoteStreamAfterRestart.mock.calls.at(-1)?.[0] as
            | MediaStream
            | null;
        expect(restarted?.getTracks()).toContain(remoteTrack);
        peer.dispose();
    });
});
