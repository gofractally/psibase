import { describe, expect, it } from "vitest";

import {
    avTransition,
    deriveAvSnapshot,
    initialAvCallRunSnapshot,
    initialAvRunMachineState,
    type AvRunContext,
    type AvRunMachineState,
} from "./av-call-run-state-machine";

const SELF = "alice";
const BOB = "bob";
const CAROL = "carol";
const SPACE = "space:test";
const SESSION = "wrtc:av-1";

function ctx(
    overrides: Partial<AvRunContext> & Pick<AvRunContext, "kind">,
): AvRunContext {
    return {
        spaceUuid: SPACE,
        members:
            overrides.kind === "group" ? [SELF, BOB, CAROL] : [SELF, BOB],
        self: SELF,
        presence: { [BOB]: "online", [CAROL]: "online" },
        liveMediaReady: {},
        hasActivePeer: {},
        hasJoined: false,
        hasLocalStream: false,
        ...overrides,
    };
}

describe("av-call-run-state-machine", () => {
    it("ensure from idle starts pipeline", () => {
        const result = avTransition(
            initialAvRunMachineState(),
            { type: "ensure" },
            ctx({ kind: "dm" }),
        );
        expect(result.state).toEqual({ tag: "ensuring" });
        expect(result.commands).toEqual([{ type: "runPipeline" }]);
    });

    it("sessionResolved with no peers online waits", () => {
        const result = avTransition(
            { tag: "creating" },
            {
                type: "sessionResolved",
                sessionId: SESSION,
                anyPeerOnline: false,
            },
            ctx({ kind: "dm", presence: { [BOB]: "offline" } }),
        );
        expect(result.state).toEqual({
            tag: "waitingPeer",
            sessionId: SESSION,
        });
        expect(result.commands).toHaveLength(0);
    });

    it("sessionResolved with peer online emits beginSignaling", () => {
        const result = avTransition(
            { tag: "creating" },
            {
                type: "sessionResolved",
                sessionId: SESSION,
                anyPeerOnline: true,
            },
            ctx({ kind: "dm" }),
        );
        expect(result.state.tag).toBe("signaling");
        expect(result.commands).toEqual([
            { type: "beginSignaling", sessionId: SESSION },
        ]);
    });

    describe("incoming invite flow", () => {
        it("sessionInvite stashes pendingInvite (does not auto-join)", () => {
            const result = avTransition(
                { tag: "idle" },
                {
                    type: "sessionInvite",
                    sessionId: SESSION,
                    from: BOB,
                    wantVideo: true,
                    wantAudio: true,
                },
                ctx({ kind: "dm" }),
            );
            expect(result.state.tag).toBe("pendingInvite");
            expect(result.commands).toEqual([
                {
                    type: "notifyPendingInvite",
                    sessionId: SESSION,
                    from: BOB,
                    wantVideo: true,
                    wantAudio: true,
                },
            ]);
        });

        it("acceptInvite from pending transitions to signaling and emits beginSignaling", () => {
            const result = avTransition(
                {
                    tag: "pendingInvite",
                    sessionId: SESSION,
                    from: BOB,
                    wantVideo: true,
                    wantAudio: true,
                },
                { type: "acceptInvite" },
                ctx({ kind: "dm" }),
            );
            expect(result.state.tag).toBe("signaling");
            expect(
                result.commands.some(
                    (c) => c.type === "beginSignaling",
                ),
            ).toBe(true);
            expect(
                result.commands.some(
                    (c) =>
                        c.type === "clearPendingInvite" &&
                        c.sessionId === SESSION,
                ),
            ).toBe(true);
        });

        it("declineInvite goes to failed and joins+leaves to notify peer", () => {
            const result = avTransition(
                {
                    tag: "pendingInvite",
                    sessionId: SESSION,
                    from: BOB,
                    wantVideo: true,
                    wantAudio: true,
                },
                { type: "declineInvite", reason: "user" },
                ctx({ kind: "dm" }),
            );
            expect(result.state.tag).toBe("failed");
            const cmdTypes = result.commands.map((c) => c.type);
            expect(cmdTypes).toContain("joinSession");
            expect(cmdTypes).toContain("leaveSession");
            expect(cmdTypes).toContain("commitTimelineEvent");
        });

        it("declineInvite with timeout uses timeout reason", () => {
            const result = avTransition(
                {
                    tag: "pendingInvite",
                    sessionId: SESSION,
                    from: BOB,
                    wantVideo: true,
                    wantAudio: true,
                },
                { type: "declineInvite", reason: "timeout" },
                ctx({ kind: "dm" }),
            );
            const leave = result.commands.find(
                (c) => c.type === "leaveSession",
            );
            expect(leave).toBeDefined();
            if (leave?.type === "leaveSession") {
                expect(leave.reason).toBe("timeout");
            }
        });

        it("ensure during pendingInvite is ignored (no auto-accept)", () => {
            const result = avTransition(
                {
                    tag: "pendingInvite",
                    sessionId: SESSION,
                    from: BOB,
                    wantVideo: true,
                    wantAudio: true,
                },
                { type: "ensure" },
                ctx({ kind: "dm" }),
            );
            expect(result.state.tag).toBe("pendingInvite");
            expect(result.commands[0]).toMatchObject({ type: "logIgnored" });
        });

        it("sessionInvite for different session is ignored", () => {
            const state: AvRunMachineState = {
                tag: "pendingInvite",
                sessionId: SESSION,
                from: BOB,
                wantVideo: true,
                wantAudio: true,
            };
            const result = avTransition(
                state,
                {
                    type: "sessionInvite",
                    sessionId: "wrtc:other",
                    from: BOB,
                    wantVideo: true,
                    wantAudio: true,
                },
                ctx({ kind: "dm" }),
            );
            expect(result.state).toEqual(state);
            expect(result.commands[0]).toMatchObject({ type: "logIgnored" });
        });

        it("sessionInvite while joined is ignored", () => {
            const state: AvRunMachineState = {
                tag: "ready",
                sessionId: SESSION,
                peerSlots: { [BOB]: "ready" },
                signalingJoined: true,
            };
            const result = avTransition(
                state,
                {
                    type: "sessionInvite",
                    sessionId: SESSION,
                    from: BOB,
                    wantVideo: true,
                    wantAudio: true,
                },
                ctx({ kind: "dm", hasJoined: true }),
            );
            expect(result.state).toEqual(state);
            expect(result.commands[0]).toMatchObject({ type: "logIgnored" });
        });
    });

    describe("media events", () => {
        it("DM mediaConnected transitions signaling -> ready", () => {
            const state: AvRunMachineState = {
                tag: "signaling",
                sessionId: SESSION,
                peerSlots: { [BOB]: "connecting" },
                signalingJoined: true,
            };
            const result = avTransition(
                state,
                { type: "mediaConnected", remoteAccount: BOB },
                ctx({
                    kind: "dm",
                    liveMediaReady: { [BOB]: true },
                    hasActivePeer: { [BOB]: true },
                    hasJoined: true,
                }),
            );
            expect(result.state.tag).toBe("ready");
            expect(
                result.commands.some(
                    (c) =>
                        c.type === "notifyMediaReady" &&
                        c.remoteAccount === BOB,
                ),
            ).toBe(true);
        });

        it("group mediaConnected stays signaling until all online peers ready", () => {
            const state: AvRunMachineState = {
                tag: "signaling",
                sessionId: SESSION,
                peerSlots: { [BOB]: "connecting", [CAROL]: "connecting" },
                signalingJoined: true,
            };
            const result = avTransition(
                state,
                { type: "mediaConnected", remoteAccount: BOB },
                ctx({
                    kind: "group",
                    liveMediaReady: { [BOB]: true },
                    hasActivePeer: { [BOB]: true },
                    hasJoined: true,
                }),
            );
            expect(result.state.tag).toBe("signaling");
        });

        it("group mediaConnected reaches ready when all online peers ready", () => {
            const state: AvRunMachineState = {
                tag: "signaling",
                sessionId: SESSION,
                peerSlots: { [BOB]: "ready", [CAROL]: "connecting" },
                signalingJoined: true,
            };
            const result = avTransition(
                state,
                { type: "mediaConnected", remoteAccount: CAROL },
                ctx({
                    kind: "group",
                    liveMediaReady: { [BOB]: true, [CAROL]: true },
                    hasActivePeer: { [BOB]: true, [CAROL]: true },
                    hasJoined: true,
                }),
            );
            expect(result.state.tag).toBe("ready");
        });

        it("mediaLost schedules recovery and disposes peer", () => {
            const state: AvRunMachineState = {
                tag: "ready",
                sessionId: SESSION,
                peerSlots: { [BOB]: "ready" },
                signalingJoined: true,
            };
            const result = avTransition(
                state,
                { type: "mediaLost", remoteAccount: BOB, detail: "ice failed" },
                ctx({ kind: "dm", hasJoined: true }),
            );
            const types = result.commands.map((c) => c.type);
            expect(types).toContain("disposePeer");
            expect(types).toContain("scheduleRecovery");
            expect(result.state.tag).toBe("signaling");
        });
    });

    describe("participantJoined", () => {
        it("for unknown session id is ignored", () => {
            const state: AvRunMachineState = {
                tag: "signaling",
                sessionId: SESSION,
                peerSlots: {},
                signalingJoined: true,
            };
            const result = avTransition(
                state,
                {
                    type: "participantJoined",
                    sessionId: "wrtc:other",
                    participant: BOB,
                },
                ctx({ kind: "group" }),
            );
            expect(result.state).toEqual(state);
            expect(result.commands[0]).toMatchObject({ type: "logIgnored" });
        });

        it("group while ready disposes the rejoining peer first", () => {
            const ready: AvRunMachineState = {
                tag: "ready",
                sessionId: SESSION,
                peerSlots: { [BOB]: "ready", [CAROL]: "ready" },
                signalingJoined: true,
            };
            const result = avTransition(
                ready,
                {
                    type: "participantJoined",
                    sessionId: SESSION,
                    participant: BOB,
                },
                ctx({
                    kind: "group",
                    hasJoined: true,
                    liveMediaReady: { [BOB]: true, [CAROL]: true },
                    hasActivePeer: { [BOB]: true, [CAROL]: true },
                }),
            );
            expect(result.commands[0]).toMatchObject({
                type: "disposePeer",
                remoteAccount: BOB,
            });
            expect(
                result.commands.some((c) => c.type === "beginSignaling"),
            ).toBe(true);
        });

        it("DM rejoin while signaling triggers resendOffer (not full re-create)", () => {
            const state: AvRunMachineState = {
                tag: "signaling",
                sessionId: SESSION,
                peerSlots: { [BOB]: "connecting" },
                signalingJoined: true,
            };
            const result = avTransition(
                state,
                {
                    type: "participantJoined",
                    sessionId: SESSION,
                    participant: BOB,
                },
                ctx({
                    kind: "dm",
                    hasJoined: true,
                    hasActivePeer: { [BOB]: true },
                }),
            );
            expect(result.commands).toEqual([
                { type: "resendOffer", remoteAccount: BOB },
            ]);
        });
    });

    describe("transportTornDown", () => {
        it("from ready falls back to signaling with reseeded slots", () => {
            const ready: AvRunMachineState = {
                tag: "ready",
                sessionId: SESSION,
                peerSlots: { [BOB]: "ready", [CAROL]: "ready" },
                signalingJoined: true,
            };
            const result = avTransition(
                ready,
                { type: "transportTornDown", reason: "ws closed" },
                ctx({
                    kind: "group",
                    presence: { [BOB]: "online", [CAROL]: "offline" },
                }),
            );
            expect(result.state.tag).toBe("signaling");
            if (result.state.tag === "signaling") {
                expect(result.state.peerSlots).toEqual({
                    [BOB]: "connecting",
                });
                expect(result.state.signalingJoined).toBe(false);
            }
            expect(
                result.commands.some((c) => c.type === "disposeAllPeers"),
            ).toBe(true);
        });
    });

    describe("recovery storm", () => {
        it("repeated recoveryTick emits exactly one beginSignaling per tick", () => {
            let state: AvRunMachineState = {
                tag: "signaling",
                sessionId: SESSION,
                peerSlots: { [BOB]: "connecting" },
                signalingJoined: true,
            };
            const c = ctx({
                kind: "dm",
                presence: { [BOB]: "online" },
                hasJoined: true,
            });
            for (let i = 0; i < 5; i++) {
                const r = avTransition(
                    state,
                    { type: "recoveryTick", sessionId: SESSION },
                    c,
                );
                state = r.state;
                expect(
                    r.commands.filter((cmd) => cmd.type === "beginSignaling")
                        .length,
                ).toBe(1);
            }
        });

        it("recoveryTick for stale session is ignored", () => {
            const result = avTransition(
                {
                    tag: "signaling",
                    sessionId: SESSION,
                    peerSlots: {},
                    signalingJoined: true,
                },
                { type: "recoveryTick", sessionId: "wrtc:other" },
                ctx({ kind: "dm" }),
            );
            expect(result.commands[0]).toMatchObject({ type: "logIgnored" });
        });
    });

    describe("hangup and dispose", () => {
        it("hangup from ready emits leaveSession + commitTimelineEvent", () => {
            const ready: AvRunMachineState = {
                tag: "ready",
                sessionId: SESSION,
                peerSlots: { [BOB]: "ready" },
                signalingJoined: true,
            };
            const result = avTransition(
                ready,
                { type: "hangup", reason: "ended" },
                ctx({ kind: "dm", hasJoined: true }),
            );
            expect(result.state.tag).toBe("failed");
            const types = result.commands.map((c) => c.type);
            expect(types).toContain("leaveSession");
            expect(types).toContain("commitTimelineEvent");
            expect(types).toContain("disposeAllPeers");
            expect(types).toContain("releaseLocalMedia");
        });

        it("dispose from ready issues leaveSession", () => {
            const ready: AvRunMachineState = {
                tag: "ready",
                sessionId: SESSION,
                peerSlots: { [BOB]: "ready" },
                signalingJoined: true,
            };
            const result = avTransition(
                ready,
                { type: "dispose" },
                ctx({ kind: "dm", hasJoined: true }),
            );
            expect(result.state.tag).toBe("idle");
            expect(
                result.commands.some(
                    (c) =>
                        c.type === "leaveSession" &&
                        c.reason === "client-disposed",
                ),
            ).toBe(true);
        });
    });

    describe("snapshot derivation", () => {
        it("ready falls back to signaling phase if media not actually connected", () => {
            const ready: AvRunMachineState = {
                tag: "ready",
                sessionId: SESSION,
                peerSlots: { [BOB]: "ready" },
                signalingJoined: true,
            };
            const live = deriveAvSnapshot(
                ready,
                ctx({
                    kind: "dm",
                    liveMediaReady: { [BOB]: false },
                    hasActivePeer: { [BOB]: true },
                    hasJoined: true,
                }),
            );
            expect(live.phase).toBe("signaling");
            expect(live.mediaConnected).toBe(false);
        });

        it("DM signaling derives mediaConnected from live state", () => {
            const state: AvRunMachineState = {
                tag: "signaling",
                sessionId: SESSION,
                peerSlots: { [BOB]: "ready" },
                signalingJoined: true,
            };
            const live = deriveAvSnapshot(
                state,
                ctx({
                    kind: "dm",
                    liveMediaReady: { [BOB]: true },
                    hasJoined: true,
                }),
            );
            expect(live.phase).toBe("ready");
            expect(live.mediaConnected).toBe(true);
        });

        it("group derives meshPeerSignalingReady from live state", () => {
            const state: AvRunMachineState = {
                tag: "signaling",
                sessionId: SESSION,
                peerSlots: { [BOB]: "ready", [CAROL]: "connecting" },
                signalingJoined: true,
            };
            const live = deriveAvSnapshot(
                state,
                ctx({
                    kind: "group",
                    liveMediaReady: { [BOB]: true, [CAROL]: false },
                }),
            );
            expect(live.meshPeerSignalingReady).toEqual({
                [BOB]: true,
                [CAROL]: false,
            });
        });

        it("pendingInvite derives waiting-peer phase for UI", () => {
            const state: AvRunMachineState = {
                tag: "pendingInvite",
                sessionId: SESSION,
                from: BOB,
                wantVideo: true,
                wantAudio: true,
            };
            const snap = deriveAvSnapshot(state, ctx({ kind: "dm" }));
            expect(snap.phase).toBe("waiting-peer");
            expect(snap.sessionId).toBe(SESSION);
        });

        it("initialAvCallRunSnapshot for incoming invite produces waiting-peer snapshot", () => {
            const snap = initialAvCallRunSnapshot({
                spaceUuid: SPACE,
                kind: "dm",
                members: [SELF, BOB],
                self: SELF,
                sessionId: SESSION,
                incomingInvite: {
                    from: BOB,
                    wantVideo: true,
                    wantAudio: true,
                },
            });
            expect(snap.phase).toBe("waiting-peer");
            expect(snap.sessionId).toBe(SESSION);
        });
    });

    describe("presence", () => {
        it("presenceOffline in DM falls back to waitingPeer and disposes peers", () => {
            const ready: AvRunMachineState = {
                tag: "ready",
                sessionId: SESSION,
                peerSlots: { [BOB]: "ready" },
                signalingJoined: true,
            };
            const result = avTransition(
                ready,
                { type: "presenceOffline", account: BOB },
                ctx({ kind: "dm", hasJoined: true }),
            );
            expect(result.state).toEqual({
                tag: "waitingPeer",
                sessionId: SESSION,
            });
            expect(
                result.commands.some((c) => c.type === "disposeAllPeers"),
            ).toBe(true);
        });

        it("presenceOffline for non-member is ignored", () => {
            const result = avTransition(
                {
                    tag: "signaling",
                    sessionId: SESSION,
                    peerSlots: {},
                    signalingJoined: true,
                },
                { type: "presenceOffline", account: "stranger" },
                ctx({ kind: "dm" }),
            );
            expect(result.commands[0]).toMatchObject({ type: "logIgnored" });
        });

        it("group presenceOffline last-online-peer falls back to waitingPeer", () => {
            const result = avTransition(
                {
                    tag: "signaling",
                    sessionId: SESSION,
                    peerSlots: { [BOB]: "ready" },
                    signalingJoined: true,
                },
                { type: "presenceOffline", account: BOB },
                ctx({
                    kind: "group",
                    members: [SELF, BOB, CAROL],
                    presence: { [BOB]: "offline", [CAROL]: "offline" },
                    hasJoined: true,
                }),
            );
            expect(result.state.tag).toBe("waitingPeer");
        });
    });

    describe("property: random event sequences keep state in union", () => {
        it("never produces undefined or invalid tag", () => {
            const events = [
                { type: "ensure" } as const,
                { type: "pipelineCreating" } as const,
                {
                    type: "sessionResolved" as const,
                    sessionId: SESSION,
                    anyPeerOnline: true,
                },
                {
                    type: "participantJoined" as const,
                    sessionId: SESSION,
                    participant: BOB,
                },
                {
                    type: "mediaConnected" as const,
                    remoteAccount: BOB,
                },
                {
                    type: "mediaLost" as const,
                    remoteAccount: BOB,
                    detail: "lost",
                },
                {
                    type: "transportTornDown" as const,
                    reason: "ws closed",
                },
                {
                    type: "presenceOnline" as const,
                    account: BOB,
                },
                {
                    type: "presenceOffline" as const,
                    account: BOB,
                },
                {
                    type: "recoveryTick" as const,
                    sessionId: SESSION,
                },
                {
                    type: "sessionEnded" as const,
                    sessionId: SESSION,
                    reason: "ended",
                },
                { type: "hangup" as const, reason: "user" },
                { type: "dispose" as const },
            ];

            // Replay 200 random sequences of length 8.
            for (let trial = 0; trial < 200; trial++) {
                let state: AvRunMachineState = initialAvRunMachineState();
                for (let i = 0; i < 8; i++) {
                    const e = events[Math.floor(Math.random() * events.length)]!;
                    const r = avTransition(state, e, ctx({ kind: "group" }));
                    state = r.state;
                    expect(
                        [
                            "idle",
                            "ensuring",
                            "creating",
                            "waitingPeer",
                            "joining",
                            "signaling",
                            "ready",
                            "pendingInvite",
                            "failed",
                        ].includes(state.tag),
                    ).toBe(true);
                }
            }
        });
    });
});
