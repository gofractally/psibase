import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RealtimeHandlers } from "./realtime-client";
import type { ServerRealtimeFrame } from "./realtime-protocol";

vi.mock("./av-call-debug", () => ({
    avCallLog: () => {},
    avCallRecord: () => {},
    avCallTeardownLog: () => {},
    shortSessionId: (id: string) => id,
    shortSpaceId: (id: string) => id,
}));

vi.mock("./chat-api", () => ({
    fetchActiveAvCallSession: vi.fn(),
    createAvCallSession: vi.fn(),
    waitForActiveAvCallSession: vi.fn(),
    commitWebRtcSessionEvent: vi.fn(async () => undefined),
    CHAT_WEBRTC_EVENT_PARTICIPANT_JOINED: 1,
    CHAT_WEBRTC_EVENT_SESSION_FAILED: 3,
    CHAT_WEBRTC_EVENT_SESSION_ENDED: 4,
}));

const buildPeerMock = vi.hoisted(() => {
    const peers: MockPeer[] = [];

    type MockPeerParams = {
        sessionId: string;
        selfAccount: string;
        peerAccount: string;
        isInitiator: boolean;
        wantVideo: boolean;
        wantAudio: boolean;
        iceServers?: import("./protocol").IceServerConfig[] | null;
    };

    class MockPeer {
        readonly sessionId: string;

        readonly selfAccount: string;

        readonly peerAccount: string;

        readonly isInitiator: boolean;

        readonly wantVideo: boolean;

        readonly wantAudio: boolean;

        readonly iceServers: import("./protocol").IceServerConfig[] | null;

        isMediaConnected = false;

        isDisposed = false;

        resendOfferCount = 0;

        startCalls = 0;

        handleRemoteSignalCalls: Array<{ kind: string; from?: string }> = [];

        constructor(params: MockPeerParams) {
            this.sessionId = params.sessionId;
            this.selfAccount = params.selfAccount;
            this.peerAccount = params.peerAccount;
            this.isInitiator = params.isInitiator;
            this.wantVideo = params.wantVideo;
            this.wantAudio = params.wantAudio;
            this.iceServers = params.iceServers ?? null;
            peers.push(this);
        }

        simulateMediaConnected(): void {
            this.isMediaConnected = true;
        }

        start(): Promise<void> {
            this.startCalls += 1;
            return Promise.resolve();
        }

        async handleRemoteSignal(frame: {
            from?: string;
            kind: string;
        }): Promise<void> {
            this.handleRemoteSignalCalls.push(frame);
        }

        resendOffer(): void {
            this.resendOfferCount += 1;
        }

        dispose(): void {
            this.isDisposed = true;
            this.isMediaConnected = false;
        }

        getLocalStream(): MediaStream | null {
            return null;
        }

        getRemoteStream(): MediaStream | null {
            return null;
        }
    }

    return { peers, MockPeer };
});

vi.mock("./local-media", () => ({
    acquireMeetLocalMedia: vi.fn(async () => ({
        stream: { getTracks: () => [] } as unknown as MediaStream,
        videoDisabled: false,
    })),
}));

vi.mock("./meet-webrtc-peer", () => ({
    MeetWebRtcPeer: buildPeerMock.MockPeer,
}));

import {
    createAvCallSession,
    fetchActiveAvCallSession,
    waitForActiveAvCallSession,
} from "./chat-api";
import { AvCallSessionOrchestrator } from "./av-call-session-orchestrator";

const SELF = "alice";
const PEER = "bob";
const PEER2 = "carol";
const SPACE_DM = "space:dm-alpha";
const SPACE_GROUP = "space:group-beta";
const SESSION_ID = "wrtc:av-111";
const SESSION_GROUP = "wrtc:av-group-222";

class FakeRealtimeClient {
    instanceId = "rt-fake-av-1";

    isSessionReady = true;

    handlers: RealtimeHandlers = {};

    sentClientFrames: unknown[] = [];

    registerHandlers(extra: RealtimeHandlers): void {
        this.handlers = { ...this.handlers, ...extra };
    }

    sendClientFrame(frame: unknown): void {
        this.sentClientFrames.push(frame);
    }

    dispatch(frame: ServerRealtimeFrame): void {
        const handler = (this.handlers as Record<string, unknown>)[frame.t];
        if (typeof handler === "function") {
            (handler as (f: ServerRealtimeFrame) => void)(frame);
        }
    }
}

function makeOrchestrator(opts?: {
    onIncomingInvite?: (invite: {
        sessionId: string;
        spaceUuid: string;
        from: string;
        wantVideo: boolean;
        wantAudio: boolean;
    }) => void;
    presence?: Record<string, string>;
    iceServers?: import("./protocol").IceServerConfig[] | null;
}): {
    orch: AvCallSessionOrchestrator;
    rt: FakeRealtimeClient;
    presence: Record<string, string>;
} {
    const rt = new FakeRealtimeClient();
    const presence: Record<string, string> = opts?.presence ?? {
        [PEER]: "online",
        [PEER2]: "online",
    };
    const orch = new AvCallSessionOrchestrator(
        () => rt as unknown as import("./realtime-client").RealtimeClient,
        () => SELF,
        () => opts?.iceServers ?? null,
        () => presence,
        opts?.onIncomingInvite,
    );
    orch.start();
    return { orch, rt, presence };
}

describe("AvCallSessionOrchestrator — DM lifecycle", () => {
    beforeEach(() => {
        vi.mocked(fetchActiveAvCallSession).mockResolvedValue(null);
        vi.mocked(createAvCallSession).mockResolvedValue(undefined);
        vi.mocked(waitForActiveAvCallSession).mockResolvedValue({
            session_id: SESSION_ID,
            space_uuid: SPACE_DM,
            purpose: "av-call",
            participants: [SELF, PEER],
            lifecycle: 1,
            expires_at: 0,
            created_at: 0,
        });
    });

    afterEach(() => {
        buildPeerMock.peers.length = 0;
        vi.clearAllMocks();
    });

    it("creates av-call session lazily when ensureDmAvCallSession runs", async () => {
        const { orch, rt } = makeOrchestrator();
        orch.ensureDmAvCallSession(SPACE_DM, [SELF, PEER]);

        await vi.waitFor(() => {
            expect(createAvCallSession).toHaveBeenCalledWith(SPACE_DM, [
                SELF,
                PEER,
            ]);
        });

        await vi.waitFor(() => {
            expect(
                rt.sentClientFrames.some(
                    (f) =>
                        typeof f === "object" &&
                        f !== null &&
                        (f as { t?: string }).t === "joinSession" &&
                        (f as { sessionId?: string }).sessionId === SESSION_ID,
                ),
            ).toBe(true);
        });

        expect(orch.getSnapshot(SPACE_DM).phase).toBe("signaling");
        expect(buildPeerMock.peers).toHaveLength(1);
        expect(buildPeerMock.peers[0]?.isInitiator).toBe(true);
        expect(buildPeerMock.peers[0]?.startCalls).toBe(1);
        orch.dispose();
    });

    it("passes welcome iceServers from host into Meet peer connections", async () => {
        const turnWelcome = [
            {
                urls: "turn:turn.example.com:3478",
                username: "user",
                credential: "pass",
            },
        ];
        const { orch } = makeOrchestrator({ iceServers: turnWelcome });
        orch.ensureDmAvCallSession(SPACE_DM, [SELF, PEER]);

        await vi.waitFor(() => {
            expect(buildPeerMock.peers).toHaveLength(1);
        });
        expect(buildPeerMock.peers[0]?.iceServers).toEqual(turnWelcome);
        orch.dispose();
    });

    it("does not create session until Meet is started", () => {
        const { orch } = makeOrchestrator();
        expect(orch.getSnapshot(SPACE_DM).phase).toBe("idle");
        expect(createAvCallSession).not.toHaveBeenCalled();
        orch.dispose();
    });

    it("surfaces sessionInvite for callee accept without blocking pipeline", async () => {
        const invites: unknown[] = [];
        const { orch, rt } = makeOrchestrator({
            onIncomingInvite: (invite) => invites.push(invite),
        });

        rt.dispatch({
            t: "sessionInvite",
            sessionId: SESSION_ID,
            appService: "chat",
            appSessionId: SESSION_ID,
            purpose: "av-call",
            from: PEER,
            participants: [SELF, PEER],
            transports: ["audio", "video"],
            dataChannels: [],
            expiresAt: Date.now() + 60_000,
            appMetadata: { spaceUuid: SPACE_DM },
        });

        expect(invites).toHaveLength(1);
        expect(orch.getPendingInvite()?.sessionId).toBe(SESSION_ID);
        expect(createAvCallSession).not.toHaveBeenCalled();

        orch.acceptIncomingInvite();

        await vi.waitFor(() => {
            expect(orch.getPendingInvite()).toBeNull();
        });
        expect(
            rt.sentClientFrames.some(
                (f) =>
                    typeof f === "object" &&
                    f !== null &&
                    (f as { t?: string }).t === "joinSession",
            ),
        ).toBe(true);
        await vi.waitFor(() => {
            expect(buildPeerMock.peers).toHaveLength(1);
        });
        expect(buildPeerMock.peers[0]?.isInitiator).toBe(true);
        orch.dispose();
    });

    it("routes inbound signal frames to the DM peer", async () => {
        const { orch, rt } = makeOrchestrator();
        orch.ensureDmAvCallSession(SPACE_DM, [SELF, PEER]);

        await vi.waitFor(() => {
            expect(buildPeerMock.peers).toHaveLength(1);
        });

        rt.dispatch({
            t: "signal",
            sessionId: SESSION_ID,
            from: PEER,
            to: SELF,
            kind: "offer",
            sdp: "v=0 fake-offer",
        });

        await vi.waitFor(() => {
            expect(buildPeerMock.peers[0]?.handleRemoteSignalCalls).toEqual([
                expect.objectContaining({ from: PEER, kind: "offer" }),
            ]);
        });

        expect(
            rt.sentClientFrames.some(
                (f) =>
                    typeof f === "object" &&
                    f !== null &&
                    (f as { t?: string }).t === "signal" &&
                    (f as { kind?: string }).kind === "candidate",
            ),
        ).toBe(false);
        orch.dispose();
    });

    it("duplicate sessionInvite while joined preserves hasJoined for hangup", async () => {
        const invites: unknown[] = [];
        const { orch, rt } = makeOrchestrator({
            onIncomingInvite: (invite) => invites.push(invite),
        });
        orch.ensureDmAvCallSession(SPACE_DM, [SELF, PEER]);

        await vi.waitFor(() => {
            expect(buildPeerMock.peers).toHaveLength(1);
            expect(orch.getRun(SPACE_DM)?.hasJoined).toBe(true);
        });

        const inviteCountBefore = invites.length;
        rt.dispatch({
            t: "sessionInvite",
            sessionId: SESSION_ID,
            appService: "chat",
            appSessionId: SESSION_ID,
            purpose: "av-call",
            from: SELF,
            participants: [SELF, PEER],
            transports: ["audio", "video"],
            dataChannels: [],
            expiresAt: Date.now() + 60_000,
            appMetadata: { spaceUuid: SPACE_DM },
        });

        expect(invites).toHaveLength(inviteCountBefore);
        expect(orch.getRun(SPACE_DM)?.hasJoined).toBe(true);

        const leaveCountBefore = rt.sentClientFrames.filter(
            (f) =>
                typeof f === "object" &&
                f !== null &&
                (f as { t?: string }).t === "leaveSession",
        ).length;

        orch.hangupAvCallSession(SPACE_DM, "ended");

        await vi.waitFor(() => {
            const leaveFrames = rt.sentClientFrames.filter(
                (f) =>
                    typeof f === "object" &&
                    f !== null &&
                    (f as { t?: string }).t === "leaveSession",
            );
            expect(leaveFrames.length).toBeGreaterThan(leaveCountBefore);
        });

        orch.dispose();
    });

    it("decline joinSessions then leaveSessions for objective timeline wire-back", async () => {
        const { orch, rt } = makeOrchestrator();

        rt.dispatch({
            t: "sessionInvite",
            sessionId: SESSION_ID,
            appService: "chat",
            appSessionId: SESSION_ID,
            purpose: "av-call",
            from: PEER,
            participants: [SELF, PEER],
            transports: ["audio", "video"],
            dataChannels: [],
            expiresAt: Date.now() + 60_000,
            appMetadata: { spaceUuid: SPACE_DM },
        });

        orch.declineIncomingInvite("user");

        await vi.waitFor(() => {
            expect(orch.getPendingInvite()).toBeNull();
        });
        expect(
            rt.sentClientFrames.some(
                (f) =>
                    typeof f === "object" &&
                    f !== null &&
                    (f as { t?: string }).t === "joinSession" &&
                    (f as { sessionId?: string }).sessionId === SESSION_ID,
            ),
        ).toBe(true);
        expect(
            rt.sentClientFrames.some(
                (f) =>
                    typeof f === "object" &&
                    f !== null &&
                    (f as { t?: string }).t === "leaveSession" &&
                    (f as { sessionId?: string }).sessionId === SESSION_ID &&
                    (f as { reason?: string }).reason === "declined",
            ),
        ).toBe(true);
        orch.dispose();
    });
});

describe("AvCallSessionOrchestrator — group lifecycle", () => {
    const GROUP_MEMBERS = [SELF, PEER, PEER2];

    beforeEach(() => {
        vi.mocked(fetchActiveAvCallSession).mockResolvedValue(null);
        vi.mocked(createAvCallSession).mockResolvedValue(undefined);
        vi.mocked(waitForActiveAvCallSession).mockResolvedValue({
            session_id: SESSION_GROUP,
            space_uuid: SPACE_GROUP,
            purpose: "av-call",
            participants: GROUP_MEMBERS,
            lifecycle: 1,
            expires_at: 0,
            created_at: 0,
        });
    });

    afterEach(() => {
        buildPeerMock.peers.length = 0;
        vi.clearAllMocks();
    });

    it("creates N-party av-call session lazily when ensureGroupAvCallSession runs", async () => {
        const { orch, rt } = makeOrchestrator();
        orch.ensureGroupAvCallSession(SPACE_GROUP, GROUP_MEMBERS);

        await vi.waitFor(() => {
            expect(createAvCallSession).toHaveBeenCalledWith(
                SPACE_GROUP,
                GROUP_MEMBERS,
            );
        });

        await vi.waitFor(() => {
            expect(
                rt.sentClientFrames.some(
                    (f) =>
                        typeof f === "object" &&
                        f !== null &&
                        (f as { t?: string }).t === "joinSession" &&
                        (f as { sessionId?: string }).sessionId ===
                            SESSION_GROUP,
                ),
            ).toBe(true);
        });

        const snap = orch.getSnapshot(SPACE_GROUP);
        expect(snap.phase).toBe("signaling");
        expect(snap.signalingJoined).toBe(true);
        expect(buildPeerMock.peers).toHaveLength(2);
        expect(buildPeerMock.peers.map((p) => p.peerAccount).sort()).toEqual(
            [PEER, PEER2].sort(),
        );
        expect(buildPeerMock.peers.every((p) => p.startCalls === 1)).toBe(true);
        orch.dispose();
    });

    it("waits for peers when no group members are online", async () => {
        const { orch } = makeOrchestrator({
            presence: { [PEER]: "offline", [PEER2]: "offline" },
        });
        orch.ensureGroupAvCallSession(SPACE_GROUP, GROUP_MEMBERS);

        await vi.waitFor(() => {
            expect(orch.getSnapshot(SPACE_GROUP).phase).toBe("waiting-peer");
        });
        expect(orch.getSnapshot(SPACE_GROUP).sessionId).toBe(SESSION_GROUP);
        orch.dispose();
    });

    it("onPeerOnline resumes group mesh signaling for late joiner", async () => {
        const presence: Record<string, string> = {
            [PEER]: "offline",
            [PEER2]: "offline",
        };
        const { orch, rt } = makeOrchestrator({ presence });
        orch.ensureGroupAvCallSession(SPACE_GROUP, GROUP_MEMBERS);

        await vi.waitFor(() => {
            expect(orch.getSnapshot(SPACE_GROUP).phase).toBe("waiting-peer");
        });

        presence[PEER] = "online";
        orch.onPeerOnline(PEER);

        await vi.waitFor(() => {
            expect(orch.getSnapshot(SPACE_GROUP).phase).toBe("signaling");
        }, { timeout: 5000 });

        expect(buildPeerMock.peers.some((p) => p.peerAccount === PEER)).toBe(
            true,
        );
        expect(
            rt.sentClientFrames.some(
                (f) =>
                    typeof f === "object" &&
                    f !== null &&
                    (f as { t?: string }).t === "joinSession",
            ),
        ).toBe(true);
        orch.dispose();
    });

    it("onPeerOffline tears down mesh signaling peer and returns to waiting-peer", async () => {
        const presence: Record<string, string> = {
            [PEER]: "online",
            [PEER2]: "online",
        };
        const { orch } = makeOrchestrator({ presence });
        orch.ensureGroupAvCallSession(SPACE_GROUP, GROUP_MEMBERS);

        await vi.waitFor(() => {
            expect(buildPeerMock.peers).toHaveLength(2);
        });

        presence[PEER] = "offline";
        presence[PEER2] = "offline";
        orch.onPeerOffline(PEER);
        orch.onPeerOffline(PEER2);

        await vi.waitFor(() => {
            expect(buildPeerMock.peers.every((p) => p.isDisposed)).toBe(true);
        });

        expect(orch.getSnapshot(SPACE_GROUP).meshPeerSignalingReady?.[PEER]).toBe(
            false,
        );
        expect(orch.getSnapshot(SPACE_GROUP).phase).toBe("waiting-peer");
        orch.dispose();
    });

    it("routes inbound signal frames to the correct group mesh peer", async () => {
        const { orch, rt } = makeOrchestrator();
        orch.ensureGroupAvCallSession(SPACE_GROUP, GROUP_MEMBERS);

        await vi.waitFor(() => {
            expect(buildPeerMock.peers).toHaveLength(2);
        });

        rt.dispatch({
            t: "signal",
            sessionId: SESSION_GROUP,
            from: PEER,
            to: SELF,
            kind: "offer",
            sdp: "v=0 fake-offer",
        });

        await vi.waitFor(() => {
            const bobPeer = buildPeerMock.peers.find(
                (p) => p.peerAccount === PEER,
            );
            expect(bobPeer?.handleRemoteSignalCalls).toEqual([
                expect.objectContaining({ from: PEER, kind: "offer" }),
            ]);
        });

        orch.dispose();
    });

    it("establishes mesh PCs for all online members in 3-party call", async () => {
        const { orch } = makeOrchestrator();
        orch.ensureGroupAvCallSession(SPACE_GROUP, GROUP_MEMBERS);

        await vi.waitFor(() => {
            expect(buildPeerMock.peers).toHaveLength(2);
        });

        for (const peer of buildPeerMock.peers) {
            peer.simulateMediaConnected();
        }

        const snap = orch.getSnapshot(SPACE_GROUP);
        expect(snap.meshPeerSignalingReady?.[PEER]).toBe(true);
        expect(snap.meshPeerSignalingReady?.[PEER2]).toBe(true);
        orch.dispose();
    });

    it("handles group sessionInvite without eager createSession", () => {
        const invites: unknown[] = [];
        const { orch, rt } = makeOrchestrator({
            onIncomingInvite: (invite) => invites.push(invite),
        });

        rt.dispatch({
            t: "sessionInvite",
            sessionId: SESSION_GROUP,
            appService: "chat",
            appSessionId: SESSION_GROUP,
            purpose: "av-call",
            from: PEER,
            participants: GROUP_MEMBERS,
            transports: ["audio", "video"],
            dataChannels: [],
            expiresAt: Date.now() + 60_000,
            appMetadata: { spaceUuid: SPACE_GROUP },
        });

        expect(invites).toHaveLength(1);
        expect(orch.getPendingInvite()?.participants).toEqual(GROUP_MEMBERS);
        expect(createAvCallSession).not.toHaveBeenCalled();
        orch.dispose();
    });

    it("duplicate group sessionInvite from another member does not reset accepted call", async () => {
        const invites: unknown[] = [];
        const { orch, rt } = makeOrchestrator({
            onIncomingInvite: (invite) => invites.push(invite),
        });

        const inviteFrame = {
            t: "sessionInvite" as const,
            sessionId: SESSION_GROUP,
            appService: "chat",
            appSessionId: SESSION_GROUP,
            purpose: "av-call" as const,
            from: PEER,
            participants: GROUP_MEMBERS,
            transports: ["audio", "video"],
            dataChannels: [],
            expiresAt: Date.now() + 60_000,
            appMetadata: { spaceUuid: SPACE_GROUP },
        };

        rt.dispatch(inviteFrame);
        expect(invites).toHaveLength(1);

        orch.acceptIncomingInvite();

        await vi.waitFor(() => {
            const run = orch.getRun(SPACE_GROUP);
            expect(run?.awaitingInviteAccept).toBe(false);
            expect(run?.hasJoined).toBe(true);
        });

        rt.dispatch({ ...inviteFrame, from: PEER2 });

        const run = orch.getRun(SPACE_GROUP);
        expect(run?.awaitingInviteAccept).toBe(false);
        expect(run?.hasJoined).toBe(true);
        expect(invites).toHaveLength(1);
        orch.dispose();
    });

    it("ignores stale sessionSnapshot epoch on av-call roster", () => {
        const { orch } = makeOrchestrator();
        orch.recordAvCallSessionSnapshot(
            SESSION_GROUP,
            GROUP_MEMBERS,
            [],
            3,
        );
        orch.recordAvCallSessionSnapshot(
            SESSION_GROUP,
            [SELF, PEER],
            [PEER2],
            2,
        );
        expect(orch.getAvCallSessionJoinedParticipants(SESSION_GROUP)).toEqual(
            GROUP_MEMBERS,
        );
        orch.dispose();
    });
});
