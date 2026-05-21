/**
 * F5 — SessionSim end-to-end invariants.
 *
 * These tests do not exist primarily to test the SessionSim harness
 * itself; they exist to catch the architectural failures the original
 * three-party bug report surfaced. Each test corresponds to a concrete
 * failure mode we want to prevent regressing:
 *
 *   - **Late joiner gets a working data channel** (F2). The newcomer
 *     is the side that sends the first offer, so the connection should
 *     converge regardless of the join order.
 *   - **Roster is server-authoritative** (F1). After every join /
 *     leave, the `sessionSnapshot` frame is broadcast and the per-run
 *     `sessionRoster` map updates accordingly. Tests assert that map's
 *     contents instead of relying on participantJoined inference.
 *   - **Transport drop is per-peer** (F1 + F4). When one client's
 *     websocket dies, the others receive `transportLost` for *that
 *     participant* but their own sessions stay alive and their other
 *     mesh peers stay connected.
 *   - **Late join → message flows** end-to-end. A message sent by one
 *     client lands in the other client's `received` log after the
 *     sim settles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatSessionEntry } from "./chat-api";
import type { ChatDataPeerHandlers } from "./chat-data-webrtc-peer";

/* --------------------------------------------------------------------------
 * Mock chat-api so the orchestrator's `ensureChatDataSession` path stops at
 * the SimChain instead of trying to call supervisor/graphql. The mock
 * delegates to a module-level `__simChain` set by each test in beforeEach.
 * -------------------------------------------------------------------------- */

const chainHolder = vi.hoisted(() => {
    let chain: {
        activeSession(spaceUuid: string): ChatSessionEntry | null;
        findBySessionId(sessionId: string): ChatSessionEntry | null;
    } | null = null;
    return {
        get: () => chain,
        set(next: typeof chain) {
            chain = next;
        },
    };
});

vi.mock("./chat-data-debug", () => ({
    chatDataLog: () => {},
    chatDataRecord: () => {},
    shortSessionId: (id: string) => id,
    shortSpaceId: (id: string) => id,
    installChatDataDebugGlobal: () => {},
}));

vi.mock("./chat-api", () => ({
    canonicalChatParticipants: (members: readonly string[]) =>
        [...members].sort(),
    createChatDataSession: vi.fn(
        async (_spaceUuid: string, _participants: readonly string[]) => {
            // SimChain entries are pre-declared by the test, so create
            // is a no-op here.
        },
    ),
    fetchActiveChatDataSession: vi.fn(
        async (spaceUuid: string) =>
            chainHolder.get()?.activeSession(spaceUuid) ?? null,
    ),
    waitForActiveChatDataSession: vi.fn(
        async (spaceUuid: string) =>
            chainHolder.get()?.activeSession(spaceUuid) ?? null,
    ),
    commitWebRtcSessionEvent: vi.fn(async () => {}),
    CHAT_DATA_PURPOSE: "chat-data",
    AV_CALL_PURPOSE: "av-call",
}));

/* --------------------------------------------------------------------------
 * Mock ChatDataWebRtcPeer with the SimRtcPeer so paired clients auto-link.
 * -------------------------------------------------------------------------- */

const rtcHolder = vi.hoisted(() => {
    let registry: import("./chat-data-session-sim-rtc").SimRtcRegistry | null =
        null;
    return {
        get: () => registry,
        set(next: typeof registry) {
            registry = next;
        },
    };
});

vi.mock("./chat-data-webrtc-peer", async () => {
    const { SimRtcPeer } = await import("./chat-data-session-sim-rtc");
    type ChatDataWebRtcPeerParams = {
        sessionId: string;
        selfAccount: string;
        peerAccount: string;
        iceServers: unknown;
        signaling: unknown;
        isInitiator: boolean;
        impolite?: boolean;
        handlers?: ChatDataPeerHandlers;
    };
    class WrappedPeer extends SimRtcPeer {
        constructor(params: ChatDataWebRtcPeerParams) {
            const registry = rtcHolder.get();
            if (!registry) {
                throw new Error(
                    "SimRtcRegistry not installed (test must set rtcHolder)",
                );
            }
            super(registry, {
                sessionId: params.sessionId,
                selfAccount: params.selfAccount,
                peerAccount: params.peerAccount,
                isInitiator: params.isInitiator,
                handlers: params.handlers,
            });
        }
    }
    return {
        ChatDataWebRtcPeer: WrappedPeer,
        buildRtcPeerConnectionConfig: () => ({ iceServers: [] }),
    };
});

/* eslint-disable import/first */
import { SessionSim, type SimClient } from "./chat-data-session-sim";
/* eslint-enable import/first */

describe("SessionSim — DM late join", () => {
    let sim: SessionSim;

    beforeEach(async () => {
        vi.useFakeTimers();
        sim = await SessionSim.create({ participants: ["alice", "bob"] });
        chainHolder.set(sim.chain);
        rtcHolder.set(sim.registry);
    });

    afterEach(() => {
        chainHolder.set(null);
        rtcHolder.set(null);
        vi.useRealTimers();
    });

    /**
     * F1 + F2 invariant: when alice initiates a DM session and bob has a
     * live websocket, the server fans out a `sessionInvite` to bob, who
     * auto-joins, and both ends converge to a ready data channel. This
     * is the path where the legacy lex initiator rule sometimes wedged
     * because the existing peer (alice) had to do the offering even
     * though bob was the newcomer.
     */
    it("both sides converge to ready and exchange chat messages in both directions", async () => {
        const SPACE = "space:dm-alpha";
        sim.declareSession(SPACE, ["alice", "bob"], "wrtc:dm-alpha");

        const alice = sim.client("alice");
        const bob = sim.client("bob");
        alice.setEveryoneOnlineExceptSelf(["alice", "bob"]);
        bob.setEveryoneOnlineExceptSelf(["alice", "bob"]);

        // Only alice triggers the ensure; bob discovers via the
        // server-pushed sessionInvite and auto-joins.
        alice.ensureChat(SPACE, ["alice", "bob"]);
        await sim.runUntilSettled(800);

        expect(alice.getSnapshot(SPACE).phase).toBe("ready");
        expect(bob.getSnapshot(SPACE).phase).toBe("ready");

        const aliceRoster = [...(alice.getRun(SPACE)?.sessionRoster.keys() ?? [])].sort();
        const bobRoster = [...(bob.getRun(SPACE)?.sessionRoster.keys() ?? [])].sort();
        expect(aliceRoster).toEqual(["alice", "bob"]);
        expect(bobRoster).toEqual(["alice", "bob"]);

        // Exercise actual message delivery in both directions.
        expect(alice.sendChatMessage(SPACE, "bob", "hi bob")).toBe(true);
        expect(bob.sendChatMessage(SPACE, "alice", "hi alice")).toBe(true);
        await sim.runUntilSettled(200);

        const bobInbox = bob.received.filter((m) => m.spaceUuid === SPACE);
        const aliceInbox = alice.received.filter((m) => m.spaceUuid === SPACE);
        expect(bobInbox.map((m) => m.envelope.body)).toContain("hi bob");
        expect(aliceInbox.map((m) => m.envelope.body)).toContain("hi alice");
    });

    /**
     * H19: sender opens DM and queues a message before the peer has joined
     * the session; when the peer opens chat later, negotiation must converge
     * without tearing down the in-flight handshake when the roster arrives.
     */
    it("sender queues message before peer opens chat; peer still receives it", async () => {
        const SPACE = "space:dm-early-send";
        sim.declareSession(SPACE, ["alice", "bob"], "wrtc:dm-early-send");

        const alice = sim.client("alice");
        const bob = sim.client("bob");
        alice.setEveryoneOnlineExceptSelf(["alice", "bob"]);
        bob.setEveryoneOnlineExceptSelf(["alice", "bob"]);

        alice.ensureChat(SPACE, ["alice", "bob"]);
        await sim.runUntilSettled(200);
        expect(
            bob.received.filter((m) => m.spaceUuid === SPACE),
        ).toHaveLength(0);

        alice.sendChatMessage(SPACE, "bob", "before bob opened");
        await sim.runUntilSettled(100);

        bob.ensureChat(SPACE, ["alice", "bob"]);
        await sim.runUntilSettled(800);

        expect(alice.getSnapshot(SPACE).phase).toBe("ready");
        expect(bob.getSnapshot(SPACE).phase).toBe("ready");

        const bobInbox = bob.received.filter((m) => m.spaceUuid === SPACE);
        expect(bobInbox.map((m) => m.envelope.body)).toContain(
            "before bob opened",
        );
    });

    /**
     * Both sides call ensure at nearly the same time (concurrent DM open).
     */
    it("both sides ensure concurrently and exchange messages", async () => {
        const SPACE = "space:dm-concurrent";
        sim.declareSession(SPACE, ["alice", "bob"], "wrtc:dm-concurrent");

        const alice = sim.client("alice");
        const bob = sim.client("bob");
        alice.setEveryoneOnlineExceptSelf(["alice", "bob"]);
        bob.setEveryoneOnlineExceptSelf(["alice", "bob"]);

        alice.ensureChat(SPACE, ["alice", "bob"]);
        bob.ensureChat(SPACE, ["alice", "bob"]);
        await sim.runUntilSettled(800);

        expect(alice.getSnapshot(SPACE).phase).toBe("ready");
        expect(bob.getSnapshot(SPACE).phase).toBe("ready");

        expect(alice.sendChatMessage(SPACE, "bob", "concurrent hi")).toBe(true);
        await sim.runUntilSettled(200);
        const bobInbox = bob.received.filter((m) => m.spaceUuid === SPACE);
        expect(bobInbox.map((m) => m.envelope.body)).toContain("concurrent hi");
    });

});

describe("SessionSim — group three-party convergence", () => {
    let sim: SessionSim;
    let alice: SimClient;
    let bob: SimClient;
    let carol: SimClient;

    beforeEach(async () => {
        vi.useFakeTimers();
        sim = await SessionSim.create({
            participants: ["alice", "bob", "carol"],
        });
        chainHolder.set(sim.chain);
        rtcHolder.set(sim.registry);
        alice = sim.client("alice");
        bob = sim.client("bob");
        carol = sim.client("carol");
        for (const c of [alice, bob, carol]) {
            c.setEveryoneOnlineExceptSelf(["alice", "bob", "carol"]);
        }
    });

    afterEach(() => {
        chainHolder.set(null);
        rtcHolder.set(null);
        vi.useRealTimers();
    });

    /**
     * Three-party fan-in. Regardless of which order ensure is called in,
     * all three pairs should converge.
     */
    it("every pair eventually has an open data channel", async () => {
        const SPACE = "space:group-1";
        sim.declareSession(SPACE, ["alice", "bob", "carol"], "wrtc:group-1");

        alice.ensureChat(SPACE, ["alice", "bob", "carol"]);
        bob.ensureChat(SPACE, ["alice", "bob", "carol"]);
        carol.ensureChat(SPACE, ["alice", "bob", "carol"]);
        await sim.runUntilSettled(800);

        for (const c of [alice, bob, carol]) {
            const snap = c.getSnapshot(SPACE);
            expect(snap.phase, `${c.account} phase`).toBe("ready");
            expect(snap.dataChannelReady, `${c.account} dataChannelReady`).toBe(
                true,
            );
            const mesh = snap.meshPeerReady ?? {};
            for (const other of ["alice", "bob", "carol"]) {
                if (other === c.account) continue;
                expect(mesh[other], `${c.account}→${other}`).toBe(true);
            }
        }
    });

    /**
     * F1 + F4: one participant's transport dies (websocket close without
     * a clean leave). The other two participants should:
     *   - receive a `transportLost` frame for the lost participant
     *   - dispose only that participant's mesh peer
     *   - keep talking to each other (the mesh isn't poisoned)
     *
     * This is the regression we observed live as "DM that worked on
     * second try" and "group chat went silent for everyone".
     */
    it("one peer's transport drop disposes only that peer; the rest stay connected", async () => {
        const SPACE = "space:group-2";
        sim.declareSession(SPACE, ["alice", "bob", "carol"], "wrtc:group-2");

        alice.ensureChat(SPACE, ["alice", "bob", "carol"]);
        bob.ensureChat(SPACE, ["alice", "bob", "carol"]);
        carol.ensureChat(SPACE, ["alice", "bob", "carol"]);
        await sim.runUntilSettled(800);

        // Sanity: everyone is connected before we kill carol.
        for (const c of [alice, bob, carol]) {
            expect(c.getSnapshot(SPACE).phase).toBe("ready");
        }

        // Carol's tab closes — simulates browser kill.
        carol.disconnect();
        await sim.runUntilSettled(500);

        // Alice and bob still have each other.
        for (const c of [alice, bob]) {
            const snap = c.getSnapshot(SPACE);
            const mesh = snap.meshPeerReady ?? {};
            const otherOnline = c.account === "alice" ? "bob" : "alice";
            expect(
                mesh[otherOnline],
                `${c.account}→${otherOnline} after carol drop`,
            ).toBe(true);
            // The lost participant's mesh slot is no longer ready.
            expect(mesh["carol"], `${c.account}→carol after drop`).toBe(false);
            // Phase must NOT be `failed` — that would mean the mesh was
            // poisoned by carol's transport drop (the exact bug we shipped).
            expect(snap.phase, `${c.account} phase after carol drop`).not.toBe(
                "failed",
            );
        }

        // Alice can still send to bob.
        expect(alice.sendChatMessage(SPACE, "bob", "still here")).toBe(true);
        await sim.runUntilSettled(100);
        expect(
            bob.received
                .filter((m) => m.spaceUuid === SPACE)
                .map((m) => m.envelope.body),
        ).toContain("still here");
    });

    /**
     * F1 invariant: after the system settles, every client's
     * `sessionRoster` agrees with the server's authoritative joined set.
     * (Server-pushed `sessionInvite` causes peers with live sockets to
     * auto-join, so even with a single ensure call the roster converges
     * to the full participant list.)
     */
    it("every client's sessionRoster converges to the full joined set", async () => {
        const SPACE = "space:group-3";
        sim.declareSession(SPACE, ["alice", "bob", "carol"], "wrtc:group-3");

        // A single client ensures; the others discover via server-pushed
        // sessionInvite and auto-join. By the time the sim settles, all
        // three rosters should agree.
        alice.ensureChat(SPACE, ["alice", "bob", "carol"]);
        await sim.runUntilSettled(800);

        for (const c of [alice, bob, carol]) {
            expect(
                [...(c.getRun(SPACE)?.sessionRoster.keys() ?? [])].sort(),
                `${c.account} roster`,
            ).toEqual(["alice", "bob", "carol"]);
        }
    });

    /**
     * F1 + F4 + F2 — the full send-after-rejoin scenario from the
     * original bug report, end-to-end. Bob's transport drops while
     * alice is mid-send, then bob rejoins, and the message must
     * deliver after rejoin without manual intervention.
     */
    it("survives a peer disconnect and reconnect cycle", async () => {
        const SPACE = "space:group-4";
        sim.declareSession(SPACE, ["alice", "bob", "carol"], "wrtc:group-4");

        alice.ensureChat(SPACE, ["alice", "bob", "carol"]);
        await sim.runUntilSettled(600);

        for (const c of [alice, bob, carol]) {
            expect(c.getSnapshot(SPACE).phase, `${c.account} initial ready`).toBe(
                "ready",
            );
        }

        // Bob's tab dies and reopens with a fresh orchestrator. This
        // mirrors the real-world "refresh fixes it" workaround we are
        // trying to make unnecessary.
        const bob2 = sim.closeTab("bob");
        await sim.runUntilSettled(400);

        // Alice and carol see bob as not-ready in the gap.
        for (const c of [alice, carol]) {
            const mesh = c.getSnapshot(SPACE).meshPeerReady ?? {};
            const other = c.account === "alice" ? "carol" : "alice";
            expect(mesh[other], `${c.account}→${other} after drop`).toBe(true);
            expect(mesh["bob"], `${c.account}→bob after drop`).toBe(false);
        }

        // Fresh bob re-primes presence and re-ensures the chat.
        bob2.setEveryoneOnlineExceptSelf(["alice", "bob", "carol"]);
        bob2.ensureChat(SPACE, ["alice", "bob", "carol"]);
        await sim.runUntilSettled(1_200);

        // Everyone is mesh-ready again.
        for (const c of [alice, bob2, carol]) {
            const snap = c.getSnapshot(SPACE);
            expect(snap.phase, `${c.account} phase after rejoin`).toBe(
                "ready",
            );
            const mesh = snap.meshPeerReady ?? {};
            for (const other of ["alice", "bob", "carol"]) {
                if (other === c.account) continue;
                expect(mesh[other], `${c.account}→${other} after rejoin`).toBe(
                    true,
                );
            }
        }

        // Alice can send a message that bob receives post-rejoin.
        expect(alice.sendChatMessage(SPACE, "bob", "after rejoin")).toBe(true);
        await sim.runUntilSettled(100);
        expect(
            bob2.received
                .filter((m) => m.spaceUuid === SPACE)
                .map((m) => m.envelope.body),
        ).toContain("after rejoin");
    });

    /**
     * WS reconnect without a tab close: the server clears the subjective
     * join row while the orchestrator may still think `hasJoined`. Mesh must
     * recover after reconcile + re-join.
     */
    it("survives websocket reconnect on the same tab", async () => {
        const SPACE = "space:group-ws-reconnect";
        sim.declareSession(SPACE, ["alice", "bob", "carol"], "wrtc:group-ws-reconnect");

        alice.ensureChat(SPACE, ["alice", "bob", "carol"]);
        await sim.runUntilSettled(600);

        for (const c of [alice, bob, carol]) {
            expect(c.getSnapshot(SPACE).phase, `${c.account} initial ready`).toBe(
                "ready",
            );
        }

        bob.reconnectTransport();
        await sim.runUntilSettled(1_200);

        for (const c of [alice, bob, carol]) {
            const snap = c.getSnapshot(SPACE);
            expect(snap.phase, `${c.account} phase after ws reconnect`).toBe(
                "ready",
            );
            const mesh = snap.meshPeerReady ?? {};
            for (const other of ["alice", "bob", "carol"]) {
                if (other === c.account) continue;
                expect(
                    mesh[other],
                    `${c.account}→${other} after ws reconnect`,
                ).toBe(true);
            }
        }
    });

    /**
     * F7 invariant: every successful chatMessage round-trip produces a
     * corresponding messageAck back to the sender. Without this, a
     * sender-side data channel write that fails to land at the receiver
     * (because the receiver's tab closed milliseconds later) gets
     * silently marked "sent" — the long-standing "Pending msgs not
     * sending" bug.
     */
    it("each delivered chatMessage produces a messageAck back to the sender", async () => {
        const SPACE = "space:group-ack";
        sim.declareSession(SPACE, ["alice", "bob", "carol"], "wrtc:group-ack");

        alice.ensureChat(SPACE, ["alice", "bob", "carol"]);
        await sim.runUntilSettled(600);

        // Alice sends to bob and to carol; receivers ack each one.
        const msg1 = "ping-bob";
        const msg2 = "ping-carol";
        expect(alice.sendChatMessage(SPACE, "bob", msg1)).toBe(true);
        expect(alice.sendChatMessage(SPACE, "carol", msg2)).toBe(true);
        await sim.runUntilSettled(200);

        const bobMsgs = bob.received
            .filter((m) => m.spaceUuid === SPACE)
            .map((m) => m.envelope.clientMsgId);
        const carolMsgs = carol.received
            .filter((m) => m.spaceUuid === SPACE)
            .map((m) => m.envelope.clientMsgId);
        expect(bobMsgs).toHaveLength(1);
        expect(carolMsgs).toHaveLength(1);

        const aliceAcks = alice.receivedAcks.filter(
            (a) => a.spaceUuid === SPACE,
        );
        const ackFroms = aliceAcks.map((a) => a.envelope.from).sort();
        const ackMsgIds = aliceAcks.map((a) => a.envelope.clientMsgId).sort();
        expect(ackFroms).toEqual(["bob", "carol"]);
        expect(ackMsgIds.sort()).toEqual([...bobMsgs, ...carolMsgs].sort());
    });
});
