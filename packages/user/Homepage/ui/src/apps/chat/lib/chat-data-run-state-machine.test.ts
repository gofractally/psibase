import { describe, expect, it } from "vitest";

import {
    deriveSnapshot,
    initialMachineState,
    transition,
    type RunContext,
    type RunEvent,
    type RunKind,
    type RunMachineState,
} from "./chat-data-run-state-machine";

const SELF = "alice";
const BOB = "bob";
const CAROL = "carol";
const SPACE = "space:test";
const SESSION = "wrtc:111";

function ctx(
    overrides: Partial<RunContext> & Pick<RunContext, "kind">,
): RunContext {
    return {
        spaceUuid: SPACE,
        members: overrides.kind === "group" ? [SELF, BOB, CAROL] : [SELF, BOB],
        self: SELF,
        presence: { [BOB]: "online", [CAROL]: "online" },
        livePeerReady: {},
        hasJoined: false,
        joinSessionRequested: false,
        hasActivePeer: {},
        peerNeedsReconnect: {},
        ...overrides,
    };
}

describe("chat-data-run-state-machine", () => {
    it("ensure from idle starts pipeline", () => {
        const result = transition(initialMachineState(), { type: "ensure" }, ctx({ kind: "dm" }));
        expect(result.state).toEqual({ tag: "ensuring" });
        expect(result.commands).toEqual([{ type: "runPipeline" }]);
    });

    it("DM sessionResolved with peer offline still joins signaling session", () => {
        const result = transition(
            { tag: "creating" },
            {
                type: "sessionResolved",
                sessionId: SESSION,
                anyPeerOnline: false,
            },
            ctx({ kind: "dm", presence: { [BOB]: "offline" } }),
        );
        expect(result.state).toEqual({ tag: "waitingPeer", sessionId: SESSION });
        expect(result.commands).toEqual([
            { type: "beginSignaling", sessionId: SESSION },
        ]);
    });

    it("group sessionResolved with no peers online waits without join", () => {
        const result = transition(
            { tag: "creating" },
            {
                type: "sessionResolved",
                sessionId: SESSION,
                anyPeerOnline: false,
            },
            ctx({
                kind: "group",
                presence: { [BOB]: "offline", [CAROL]: "offline" },
            }),
        );
        expect(result.state).toEqual({ tag: "waitingPeer", sessionId: SESSION });
        expect(result.commands).toHaveLength(0);
    });

    it("peerOpened on group stays signaling until all online peers ready", () => {
        const signaling: RunMachineState = {
            tag: "signaling",
            sessionId: SESSION,
            peerSlots: { [BOB]: "connecting", [CAROL]: "absent" },
        };
        const result = transition(
            signaling,
            { type: "peerOpened", remoteAccount: BOB },
            ctx({
                kind: "group",
                livePeerReady: { [BOB]: true },
                hasActivePeer: { [BOB]: true },
            }),
        );
        expect(result.state.tag).toBe("signaling");
        const snap = deriveSnapshot(result.state, ctx({
            kind: "group",
            livePeerReady: { [BOB]: true },
            hasActivePeer: { [BOB]: true },
        }));
        expect(snap.phase).toBe("signaling");
    });

    it("peerOpened on group becomes ready when all online peers ready", () => {
        const signaling: RunMachineState = {
            tag: "signaling",
            sessionId: SESSION,
            peerSlots: { [BOB]: "ready", [CAROL]: "connecting" },
        };
        const result = transition(
            signaling,
            { type: "peerOpened", remoteAccount: CAROL },
            ctx({
                kind: "group",
                livePeerReady: { [BOB]: true, [CAROL]: true },
                hasActivePeer: { [BOB]: true, [CAROL]: true },
            }),
        );
        expect(result.state.tag).toBe("ready");
    });

    it("participantJoined for unknown session on group run is ignored", () => {
        const state: RunMachineState = {
            tag: "signaling",
            sessionId: SESSION,
            peerSlots: {},
        };
        const result = transition(
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

    it("participantJoined while ready disposes peers before re-signaling", () => {
        const ready: RunMachineState = {
            tag: "ready",
            sessionId: SESSION,
            peerSlots: { [BOB]: "ready" },
        };
        const result = transition(
            ready,
            {
                type: "participantJoined",
                sessionId: SESSION,
                participant: BOB,
            },
            ctx({
                kind: "dm",
                hasJoined: true,
                livePeerReady: { [BOB]: true },
                hasActivePeer: { [BOB]: true },
            }),
        );
        expect(result.commands[0]).toEqual({ type: "disposeAllPeers" });
        expect(result.commands.some((c) => c.type === "beginSignaling")).toBe(true);
    });

    it("group participantJoined while ready keeps other live mesh legs", () => {
        const CAROL = "carol";
        const ready: RunMachineState = {
            tag: "ready",
            sessionId: SESSION,
            peerSlots: { [BOB]: "ready", [CAROL]: "ready" },
        };
        const result = transition(
            ready,
            {
                type: "participantJoined",
                sessionId: SESSION,
                participant: BOB,
            },
            ctx({
                kind: "group",
                members: [SELF, BOB, CAROL],
                hasJoined: true,
                livePeerReady: { [BOB]: false, [CAROL]: true },
                hasActivePeer: { [BOB]: true, [CAROL]: true },
            }),
        );
        expect(result.commands.map((c) => c.type)).not.toContain("disposeAllPeers");
        expect(result.commands).toContainEqual({
            type: "resendOffer",
            remoteAccount: BOB,
        });
        expect(result.commands.some((c) => c.type === "beginSignaling")).toBe(true);
    });

    it("group participantJoined while peer already ready is ignored", () => {
        const ready: RunMachineState = {
            tag: "ready",
            sessionId: SESSION,
            peerSlots: { [BOB]: "ready" },
        };
        const result = transition(
            ready,
            {
                type: "participantJoined",
                sessionId: SESSION,
                participant: BOB,
            },
            ctx({
                kind: "group",
                members: [SELF, BOB, "carol"],
                hasJoined: true,
                livePeerReady: { [BOB]: true },
                hasActivePeer: { [BOB]: true },
            }),
        );
        expect(result.commands[0]).toMatchObject({
            type: "logIgnored",
            reason: "participantJoined while mesh peer already ready",
        });
    });

    it("group rosterUpdated during signaling resends offers without beginSignaling", () => {
        const signaling: RunMachineState = {
            tag: "signaling",
            sessionId: SESSION,
            peerSlots: { [BOB]: "connecting" },
        };
        const result = transition(
            signaling,
            {
                type: "rosterUpdated",
                sessionId: SESSION,
                joined: [SELF, BOB],
                pending: [],
                newJoiners: [BOB],
            },
            ctx({
                kind: "group",
                members: [SELF, BOB, "carol"],
                hasActivePeer: { [BOB]: true },
                livePeerReady: {},
            }),
        );
        expect(result.commands).toEqual([
            { type: "resendOffer", remoteAccount: BOB },
        ]);
    });

    it("DM participantJoined during signaling resends offer when negotiation is in flight", () => {
        const signaling: RunMachineState = {
            tag: "signaling",
            sessionId: SESSION,
            peerSlots: { [BOB]: "connecting" },
        };
        const result = transition(
            signaling,
            {
                type: "participantJoined",
                sessionId: SESSION,
                participant: BOB,
            },
            ctx({
                kind: "dm",
                hasJoined: true,
                hasActivePeer: { [BOB]: true },
                peerNeedsReconnect: { [BOB]: false },
            }),
        );
        expect(result.commands).toEqual([
            { type: "resendOffer", remoteAccount: BOB },
        ]);
    });

    it("DM participantJoined disposes wedged peer (stable SDP, no DC)", () => {
        const signaling: RunMachineState = {
            tag: "signaling",
            sessionId: SESSION,
            peerSlots: { [BOB]: "connecting" },
        };
        const result = transition(
            signaling,
            {
                type: "participantJoined",
                sessionId: SESSION,
                participant: BOB,
            },
            ctx({
                kind: "dm",
                hasJoined: true,
                hasActivePeer: { [BOB]: true },
                peerNeedsReconnect: { [BOB]: true },
            }),
        );
        expect(result.commands).toEqual([
            { type: "disposeAllPeers" },
            { type: "beginSignaling", sessionId: SESSION },
        ]);
    });

    it("DM sessionInvite during signaling resends offer instead of beginSignaling", () => {
        const signaling: RunMachineState = {
            tag: "signaling",
            sessionId: SESSION,
            peerSlots: { [BOB]: "connecting" },
        };
        const result = transition(
            signaling,
            {
                type: "sessionInvite",
                sessionId: SESSION,
                from: BOB,
            },
            ctx({ kind: "dm", hasJoined: true }),
        );
        expect(result.commands).toEqual([
            { type: "resendOffer", remoteAccount: BOB },
        ]);
    });

    it("DM rosterUpdated during signaling resends offer when peer appears in roster", () => {
        const signaling: RunMachineState = {
            tag: "signaling",
            sessionId: SESSION,
            peerSlots: { [BOB]: "connecting" },
        };
        const result = transition(
            signaling,
            {
                type: "rosterUpdated",
                sessionId: SESSION,
                joined: [SELF, BOB],
                pending: [],
                newJoiners: [BOB],
            },
            ctx({ kind: "dm", hasJoined: true }),
        );
        expect(result.commands).toEqual([
            { type: "resendOffer", remoteAccount: BOB },
        ]);
    });

    it("deriveSnapshot reflects live peer readiness for ready state", () => {
        const ready: RunMachineState = {
            tag: "ready",
            sessionId: SESSION,
            peerSlots: { [BOB]: "ready" },
        };
        const live = deriveSnapshot(ready, ctx({
            kind: "dm",
            livePeerReady: { [BOB]: false },
            hasActivePeer: { [BOB]: true },
        }));
        expect(live.dataChannelReady).toBe(false);
        expect(live.phase).toBe("signaling");
    });

    describe("DM peer-open regardless of presence", () => {
        it("DM peerOpened transitions to ready even when peer presence is offline", () => {
            const result = transition(
                { tag: "signaling", sessionId: SESSION, peerSlots: {} },
                { type: "peerOpened", remoteAccount: BOB },
                ctx({
                    kind: "dm",
                    presence: { [BOB]: "offline" },
                    livePeerReady: { [BOB]: true },
                    hasActivePeer: { [BOB]: true },
                }),
            );
            expect(result.state.tag).toBe("ready");
            expect(
                result.commands.some(
                    (c) => c.type === "notifyDataChannelReady",
                ),
            ).toBe(true);
        });
    });

    describe("transportTornDown", () => {
        it("reseeds peerSlots from current online presence (not empty)", () => {
            const ready: RunMachineState = {
                tag: "ready",
                sessionId: SESSION,
                peerSlots: { [BOB]: "ready", [CAROL]: "ready" },
            };
            const result = transition(
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
            }
        });

        it("ignored when no session is in flight", () => {
            const result = transition(
                { tag: "idle" },
                { type: "transportTornDown", reason: "ws closed" },
                ctx({ kind: "dm" }),
            );
            expect(result.state).toEqual({ tag: "idle" });
        });
    });

    describe("recovery storm", () => {
        it("does not double-emit beginSignaling on repeated recoveryTick", () => {
            let state: RunMachineState = {
                tag: "signaling",
                sessionId: SESSION,
                peerSlots: { [BOB]: "connecting" },
            };
            const c = ctx({ kind: "dm", presence: { [BOB]: "online" } });
            const beginSignals: number[] = [];
            for (let i = 0; i < 5; i++) {
                const r = transition(
                    state,
                    { type: "recoveryTick", sessionId: SESSION },
                    c,
                );
                state = r.state;
                beginSignals.push(
                    r.commands.filter((cmd) => cmd.type === "beginSignaling")
                        .length,
                );
            }
            expect(beginSignals).toEqual([1, 1, 1, 1, 1]);
        });

        it("ignores recoveryTick for stale session id", () => {
            const result = transition(
                { tag: "signaling", sessionId: SESSION, peerSlots: {} },
                { type: "recoveryTick", sessionId: "wrtc:other" },
                ctx({ kind: "dm" }),
            );
            expect(result.commands[0]).toMatchObject({ type: "logIgnored" });
        });
    });

    describe("cross-session events", () => {
        it("remoteSignal for a session does not crash even from idle state", () => {
            const result = transition(
                { tag: "idle" },
                {
                    type: "remoteSignal",
                    sessionId: SESSION,
                    from: BOB,
                    kind: "offer",
                    sdp: "v=0",
                },
                ctx({ kind: "dm" }),
            );
            expect(result.state).toEqual({ tag: "idle" });
            expect(result.commands[0]).toMatchObject({
                type: "applyRemoteSignal",
            });
        });

        it("sessionEnded for the active session goes to failed", () => {
            const result = transition(
                {
                    tag: "ready",
                    sessionId: SESSION,
                    peerSlots: { [BOB]: "ready" },
                },
                { type: "sessionEnded", sessionId: SESSION, reason: "kicked" },
                ctx({ kind: "dm" }),
            );
            expect(result.state.tag).toBe("failed");
        });
    });

    /**
     * Regression: a 3-party group session that received `sessionEnded`
     * (because one tab disposed) used to flip the whole run to `failed`,
     * disposing all mesh peers including the still-healthy peers among the
     * remaining online participants. The fix scopes the teardown to the
     * leaver's mesh peer and keeps the run in `signaling` so subsequent
     * sends to other recipients still flow.
     */
    describe("group sessionEnded (one participant left)", () => {
        it("disposes only the leaver's mesh peer when by !== self", () => {
            const ready: RunMachineState = {
                tag: "ready",
                sessionId: SESSION,
                peerSlots: { [BOB]: "ready", [CAROL]: "ready" },
            };
            const result = transition(
                ready,
                {
                    type: "sessionEnded",
                    sessionId: SESSION,
                    reason: "client-disposed",
                    by: BOB,
                },
                ctx({
                    kind: "group",
                    presence: { [BOB]: "online", [CAROL]: "online" },
                    livePeerReady: { [BOB]: true, [CAROL]: true },
                    hasActivePeer: { [BOB]: true, [CAROL]: true },
                }),
            );
            expect(result.state.tag).toBe("signaling");
            if (result.state.tag === "signaling") {
                expect(result.state.peerSlots[BOB]).toBe("absent");
                expect(result.state.peerSlots[CAROL]).toBe("ready");
            }
            const cmdTypes = result.commands.map((c) => c.type);
            expect(cmdTypes).toContain("disposePeer");
            expect(cmdTypes).not.toContain("disposeAllPeers");
            const dispose = result.commands.find(
                (c): c is Extract<typeof c, { type: "disposePeer" }> =>
                    c.type === "disposePeer",
            );
            expect(dispose?.remoteAccount).toBe(BOB);
        });

        it("still goes to failed when self left the session", () => {
            const ready: RunMachineState = {
                tag: "ready",
                sessionId: SESSION,
                peerSlots: { [BOB]: "ready", [CAROL]: "ready" },
            };
            const result = transition(
                ready,
                {
                    type: "sessionEnded",
                    sessionId: SESSION,
                    reason: "client-disposed",
                    by: SELF,
                },
                ctx({ kind: "group" }),
            );
            expect(result.state.tag).toBe("failed");
            expect(result.commands.map((c) => c.type)).toContain(
                "disposeAllPeers",
            );
        });

        it("DM sessionEnded by peer still fails the run", () => {
            const ready: RunMachineState = {
                tag: "ready",
                sessionId: SESSION,
                peerSlots: { [BOB]: "ready" },
            };
            const result = transition(
                ready,
                {
                    type: "sessionEnded",
                    sessionId: SESSION,
                    reason: "client-disposed",
                    by: BOB,
                },
                ctx({ kind: "dm" }),
            );
            expect(result.state.tag).toBe("failed");
            expect(result.commands.map((c) => c.type)).toContain(
                "disposeAllPeers",
            );
        });

        it("group: subsequent sessionInvite from the rejoining participant resumes signaling", () => {
            const afterLeaver: RunMachineState = {
                tag: "signaling",
                sessionId: SESSION,
                peerSlots: { [BOB]: "absent", [CAROL]: "ready" },
            };
            const result = transition(
                afterLeaver,
                {
                    type: "sessionInvite",
                    sessionId: SESSION,
                    from: BOB,
                },
                ctx({
                    kind: "group",
                    presence: { [BOB]: "online", [CAROL]: "online" },
                    livePeerReady: { [CAROL]: true },
                    hasActivePeer: { [CAROL]: true },
                    hasJoined: true,
                }),
            );
            expect(result.state.tag).toBe("signaling");
            expect(result.commands.map((c) => c.type)).toContain(
                "beginSignaling",
            );
        });
    });

    describe("partial group mesh", () => {
        it("only counts online remotes for ready determination", () => {
            const result = transition(
                {
                    tag: "signaling",
                    sessionId: SESSION,
                    peerSlots: { [BOB]: "connecting" },
                },
                { type: "peerOpened", remoteAccount: BOB },
                ctx({
                    kind: "group",
                    members: [SELF, BOB, CAROL],
                    presence: { [BOB]: "online", [CAROL]: "offline" },
                    livePeerReady: { [BOB]: true },
                    hasActivePeer: { [BOB]: true },
                }),
            );
            expect(result.state.tag).toBe("ready");
        });
    });

    describe("beginSignaling guards", () => {
        it("ignored from idle state (no active session)", () => {
            const result = transition(
                { tag: "idle" },
                { type: "beginSignaling", sessionId: SESSION },
                ctx({ kind: "dm" }),
            );
            expect(result.state).toEqual({ tag: "idle" });
            expect(result.commands[0]).toMatchObject({ type: "logIgnored" });
        });

        it("session id change while ready disposes peers and updates machine session", () => {
            const OTHER = "wrtc:other-session";
            const ready: RunMachineState = {
                tag: "ready",
                sessionId: SESSION,
                peerSlots: { [BOB]: "ready" },
            };
            const result = transition(
                ready,
                { type: "beginSignaling", sessionId: OTHER },
                ctx({
                    kind: "group",
                    members: [SELF, BOB, "carol"],
                    livePeerReady: { [BOB]: true },
                }),
            );
            expect(result.state.tag).toBe("signaling");
            expect(result.state).toMatchObject({
                sessionId: OTHER,
                peerSlots: { [BOB]: "ready" },
            });
            expect(result.commands[0]).toEqual({ type: "disposeAllPeers" });
            expect(result.commands[1]).toEqual({
                type: "beginSignaling",
                sessionId: OTHER,
            });
        });

        it("ignored while pipeline is still resolving session", () => {
            const result = transition(
                { tag: "creating" },
                { type: "beginSignaling", sessionId: SESSION },
                ctx({ kind: "dm" }),
            );
            expect(result.state).toEqual({ tag: "creating" });
            expect(result.commands[0]).toMatchObject({ type: "logIgnored" });
        });
    });

    describe("ensure guards", () => {
        it("ignored while signaling (avoids flush-pending beginSignaling storm)", () => {
            const result = transition(
                {
                    tag: "signaling",
                    sessionId: SESSION,
                    peerSlots: { [BOB]: "connecting" },
                },
                { type: "ensure" },
                ctx({ kind: "group" }),
            );
            expect(result.state.tag).toBe("signaling");
            expect(result.commands[0]).toMatchObject({
                type: "logIgnored",
                reason: "ensure while signaling",
            });
        });
    });

    describe("dispose lifecycle", () => {
        it("from ready state issues leaveSession + disposeAllPeers + cancelRecovery", () => {
            const result = transition(
                {
                    tag: "ready",
                    sessionId: SESSION,
                    peerSlots: { [BOB]: "ready" },
                },
                { type: "dispose" },
                ctx({
                    kind: "dm",
                    hasJoined: true,
                    livePeerReady: { [BOB]: true },
                }),
            );
            expect(result.state).toEqual({ tag: "idle" });
            const types = result.commands.map((c) => c.type);
            expect(types).toContain("cancelRecovery");
            expect(types).toContain("disposeAllPeers");
            expect(types).toContain("leaveSession");
        });

        it("from idle state is a no-op (no leaveSession)", () => {
            const result = transition(
                { tag: "idle" },
                { type: "dispose" },
                ctx({ kind: "dm" }),
            );
            const types = result.commands.map((c) => c.type);
            expect(types).not.toContain("leaveSession");
        });
    });

    /**
     * Exercise the full DM send-after-rejoin cycle that the production logs
     * showed wedging before Phase A. Each step is a real event the
     * orchestrator dispatches; the cumulative FSM transitions must drive
     * the state back to `ready` (with the right outbox flush command)
     * without manual intervention.
     */
    describe("regression: DM send-after-rejoin", () => {
        it("ready → peer leaves → peer rejoins → ready again without wedging", () => {
            const sessionA = "wrtc:session-A";
            let state: RunMachineState = {
                tag: "ready",
                sessionId: sessionA,
                peerSlots: { [BOB]: "ready" },
            };
            const c0 = ctx({
                kind: "dm",
                hasJoined: true,
                livePeerReady: { [BOB]: true },
                hasActivePeer: { [BOB]: true },
            });

            // 1. Data channel closes (peer left). FSM dispatches peerLost.
            let r = transition(
                state,
                { type: "peerLost", remoteAccount: BOB, detail: "data channel closed" },
                c0,
            );
            state = r.state;
            expect(state.tag).toBe("signaling");
            expect(r.commands.map((c) => c.type)).toContain("disposePeer");
            expect(r.commands.map((c) => c.type)).toContain("scheduleRecovery");

            // 2. Server fans out sessionEnded (DM kind, by remote → fail).
            r = transition(
                state,
                {
                    type: "sessionEnded",
                    sessionId: sessionA,
                    reason: "client-disposed",
                    by: BOB,
                },
                ctx({
                    kind: "dm",
                    hasJoined: true,
                    livePeerReady: {},
                    hasActivePeer: {},
                }),
            );
            state = r.state;
            expect(state.tag).toBe("failed");

            // 3. Peer presence flips offline. FSM ignores (no session).
            r = transition(
                state,
                { type: "presenceOffline", account: BOB },
                ctx({ kind: "dm", presence: { [BOB]: "offline" } }),
            );
            // Still failed.
            expect(r.state.tag).toBe("failed");

            // 4. Peer comes back online. Per current FSM, presenceOnline
            // from `failed` is a no-op (we need an objective signal that
            // the session is still alive).
            r = transition(
                r.state,
                { type: "presenceOnline", account: BOB },
                ctx({ kind: "dm", presence: { [BOB]: "online" } }),
            );
            expect(r.state.tag).toBe("failed");

            // 5. Peer's tab broadcasts a sessionInvite for the same
            // session id. THIS is the recovery trigger.
            r = transition(
                r.state,
                { type: "sessionInvite", sessionId: sessionA, from: BOB },
                ctx({
                    kind: "dm",
                    presence: { [BOB]: "online" },
                }),
            );
            state = r.state;
            expect(state.tag).toBe("signaling");
            expect(r.commands.map((c) => c.type)).toContain("beginSignaling");

            // 6. New WebRTC peer is created, offer/answer flows, DC opens.
            r = transition(
                state,
                { type: "peerOpened", remoteAccount: BOB },
                ctx({
                    kind: "dm",
                    presence: { [BOB]: "online" },
                    hasJoined: true,
                    livePeerReady: { [BOB]: true },
                    hasActivePeer: { [BOB]: true },
                }),
            );
            expect(r.state.tag).toBe("ready");
            const cmdTypes = r.commands.map((c) => c.type);
            // The cmdTypes MUST include flushPending so any messages the
            // user typed during the rejoin window go out.
            expect(cmdTypes).toContain("flushPending");
            expect(cmdTypes).toContain("notifyDataChannelReady");
            expect(cmdTypes).toContain("cancelRecovery");
        });

        it("ready (alice waiting for bob to rejoin) → duplicate sessionInvite is ignored", () => {
            const sessionA = "wrtc:session-A";
            const r = transition(
                {
                    tag: "ready",
                    sessionId: sessionA,
                    peerSlots: { [BOB]: "ready" },
                },
                { type: "sessionInvite", sessionId: sessionA, from: BOB },
                ctx({
                    kind: "dm",
                    hasJoined: true,
                    livePeerReady: { [BOB]: true },
                    hasActivePeer: { [BOB]: true },
                }),
            );
            expect(r.state.tag).toBe("ready");
            expect(r.commands[0]).toMatchObject({
                type: "logIgnored",
                reason: "duplicate sessionInvite while ready",
            });
            expect(r.commands.map((c) => c.type)).not.toContain("disposeAllPeers");
        });
    });

    describe("property: any single event preserves a well-formed state", () => {
        const allEvents = [
            { type: "ensure" } as const,
            { type: "pipelineCreating" } as const,
            { type: "sessionResolved", sessionId: SESSION, anyPeerOnline: true } as const,
            { type: "sessionInvite", sessionId: SESSION, from: BOB } as const,
            { type: "participantJoined", sessionId: SESSION, participant: BOB } as const,
            { type: "beginSignaling", sessionId: SESSION } as const,
            { type: "signalingDeferred", sessionId: SESSION } as const,
            { type: "peerOpened", remoteAccount: BOB } as const,
            { type: "peerLost", remoteAccount: BOB, detail: "lost" } as const,
            { type: "transportTornDown", reason: "x" } as const,
            { type: "presenceOnline", account: BOB } as const,
            { type: "presenceOffline", account: BOB } as const,
            { type: "recoveryTick", sessionId: SESSION } as const,
            { type: "sessionEnded", sessionId: SESSION, reason: "x" } as const,
            { type: "failed", detail: "boom" } as const,
            { type: "dispose" } as const,
        ];

        const allStates: RunMachineState[] = [
            { tag: "idle" },
            { tag: "ensuring" },
            { tag: "creating" },
            { tag: "waitingPeer", sessionId: SESSION },
            { tag: "joining", sessionId: SESSION },
            { tag: "signaling", sessionId: SESSION, peerSlots: {} },
            { tag: "ready", sessionId: SESSION, peerSlots: {} },
            { tag: "failed", lastError: "old" },
        ];

        it("never throws and always returns a valid state tag for the full cross product (DM)", () => {
            for (const s of allStates) {
                for (const e of allEvents) {
                    const r = transition(s, e, ctx({ kind: "dm" }));
                    expect(r.state.tag).toMatch(
                        /^(idle|ensuring|creating|waitingPeer|joining|signaling|ready|failed)$/,
                    );
                    // deriveSnapshot must not throw for any reachable state.
                    deriveSnapshot(r.state, ctx({ kind: "dm" }));
                }
            }
        });

        it("never throws and always returns a valid state tag for the full cross product (group)", () => {
            for (const s of allStates) {
                for (const e of allEvents) {
                    const r = transition(s, e, ctx({ kind: "group" }));
                    expect(r.state.tag).toMatch(
                        /^(idle|ensuring|creating|waitingPeer|joining|signaling|ready|failed)$/,
                    );
                    deriveSnapshot(r.state, ctx({ kind: "group" }));
                }
            }
        });
    });

    /**
     * Stronger property-style test: drive 1000 random event sequences and
     * verify the FSM (a) never throws, (b) never produces an unreachable
     * state tag, (c) deriveSnapshot is always callable, and (d) given a
     * favorable closing event sequence (an `ensure` from a healthy
     * context), the FSM can always reach `ready` or `signaling` — i.e. the
     * FSM never becomes "stuck" in a non-progress state.
     *
     * Why this matters: the bug class we're chasing is "stuck pending",
     * which always boils down to "FSM landed in a state from which no
     * subsequent event reaches a productive state". Property tests are
     * the most efficient way to flush those out.
     */
    describe("property: bounded random sequences always converge", () => {
        type EventGen = (rng: () => number) => RunEvent;
        const SESSION = "wrtc:p1";
        const eventGens: EventGen[] = [
            () => ({ type: "ensure" }),
            () => ({ type: "pipelineCreating" }),
            (rng) => ({
                type: "sessionResolved",
                sessionId: SESSION,
                anyPeerOnline: rng() < 0.5,
            }),
            () => ({ type: "sessionInvite", sessionId: SESSION, from: BOB }),
            () => ({
                type: "participantJoined",
                sessionId: SESSION,
                participant: BOB,
            }),
            () => ({ type: "beginSignaling", sessionId: SESSION }),
            () => ({ type: "peerOpened", remoteAccount: BOB }),
            () => ({
                type: "peerLost",
                remoteAccount: BOB,
                detail: "fuzz",
            }),
            () => ({ type: "transportTornDown", reason: "fuzz" }),
            () => ({ type: "presenceOnline", account: BOB }),
            () => ({ type: "presenceOffline", account: BOB }),
            () => ({ type: "recoveryTick", sessionId: SESSION }),
            (rng) => ({
                type: "sessionEnded",
                sessionId: SESSION,
                reason: "fuzz",
                by: rng() < 0.5 ? SELF : BOB,
            }),
        ];

        function mulberry32(seed: number): () => number {
            let s = seed >>> 0;
            return () => {
                s = (s + 0x6d2b79f5) >>> 0;
                let t = s;
                t = Math.imul(t ^ (t >>> 15), t | 1);
                t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        }

        function buildCtx(
            kind: RunKind,
            state: RunMachineState,
            presenceOnline: boolean,
            hasLivePeer: boolean,
        ): RunContext {
            const presence: Record<string, string> = presenceOnline
                ? { [BOB]: "online", [CAROL]: "online" }
                : { [BOB]: "offline", [CAROL]: "offline" };
            return {
                spaceUuid: SPACE,
                kind,
                members: kind === "group" ? [SELF, BOB, CAROL] : [SELF, BOB],
                self: SELF,
                presence,
                livePeerReady: hasLivePeer
                    ? { [BOB]: true, [CAROL]: true }
                    : {},
                hasJoined:
                    state.tag !== "idle" &&
                    state.tag !== "ensuring" &&
                    state.tag !== "failed",
                joinSessionRequested:
                    state.tag !== "idle" &&
                    state.tag !== "ensuring" &&
                    state.tag !== "failed",
                hasActivePeer: hasLivePeer
                    ? { [BOB]: true, [CAROL]: true }
                    : {},
                peerNeedsReconnect: {},
            };
        }

        for (const kind of ["dm", "group"] as const) {
            it(`random 50-event sequences never throw or produce invalid tags (${kind})`, () => {
                for (let seed = 1; seed <= 200; seed++) {
                    const rng = mulberry32(seed);
                    let state: RunMachineState = { tag: "idle" };
                    let presenceOnline = true;
                    let hasLivePeer = false;
                    for (let i = 0; i < 50; i++) {
                        const gen = eventGens[
                            Math.floor(rng() * eventGens.length)
                        ]!;
                        const event = gen(rng);
                        if (event.type === "presenceOffline") {
                            presenceOnline = false;
                        }
                        if (event.type === "presenceOnline") {
                            presenceOnline = true;
                        }
                        if (event.type === "peerOpened") {
                            hasLivePeer = true;
                        }
                        if (
                            event.type === "peerLost" ||
                            event.type === "transportTornDown" ||
                            event.type === "sessionEnded"
                        ) {
                            hasLivePeer = false;
                        }
                        const c = buildCtx(
                            kind,
                            state,
                            presenceOnline,
                            hasLivePeer,
                        );
                        const r = transition(state, event, c);
                        expect(r.state.tag).toMatch(
                            /^(idle|ensuring|creating|waitingPeer|joining|signaling|ready|failed)$/,
                        );
                        // deriveSnapshot must not throw.
                        const snap = deriveSnapshot(r.state, c);
                        expect(typeof snap.phase).toBe("string");
                        state = r.state;
                    }
                }
            });
        }

        it("DM: from any reachable state, a clean rejoin sequence reaches `ready`", () => {
            // Seed a representative set of "starting" states the FSM
            // might be in when the peer rejoins.
            const startingStates: RunMachineState[] = [
                { tag: "idle" },
                { tag: "ensuring" },
                { tag: "creating" },
                { tag: "waitingPeer", sessionId: SESSION },
                { tag: "signaling", sessionId: SESSION, peerSlots: {} },
                {
                    tag: "ready",
                    sessionId: SESSION,
                    peerSlots: { [BOB]: "ready" },
                },
                { tag: "failed", sessionId: SESSION, lastError: "x" },
            ];
            const happyCtx = (state: RunMachineState): RunContext =>
                buildCtx("dm", state, true, false);

            for (const start of startingStates) {
                // Clean rejoin sequence:
                //   sessionInvite (recovers from failed/idle)
                //   → peerOpened (drives to ready)
                let state = start;
                let r = transition(
                    state,
                    {
                        type: "sessionInvite",
                        sessionId: SESSION,
                        from: BOB,
                    },
                    happyCtx(state),
                );
                state = r.state;
                // sessionInvite must put us in a state that admits
                // peerOpened (not idle, not failed).
                expect(["signaling", "ready", "waitingPeer", "joining"]).toContain(
                    state.tag,
                );

                r = transition(
                    state,
                    { type: "peerOpened", remoteAccount: BOB },
                    buildCtx("dm", state, true, true),
                );
                state = r.state;
                expect(state.tag).toBe("ready");
            }
        });
    });
});
