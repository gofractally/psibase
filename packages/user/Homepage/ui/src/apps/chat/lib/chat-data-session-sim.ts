/**
 * SessionSim — deterministic in-memory harness for chat-data WebRTC.
 *
 * Why this exists (F5)
 * --------------------
 * The bugs we have been chasing — "send-after-rejoin", "group chat stuck
 * Pending", "DM only works on second try" — are all *interaction* bugs
 * between multiple clients, the signaling server, and the WebRTC
 * negotiation FSM. Single-client unit tests catch single-client bugs;
 * they cannot catch the bugs we keep shipping.
 *
 * `SessionSim` is the missing third leg: a deterministic, in-memory,
 * multi-client harness that obeys the **server contract** (the F1
 * sessionSnapshot/transportLost/sessionInvite/participantJoined fan-out
 * rules) and lets tests assert end-to-end invariants like "every queued
 * message eventually arrives at every recipient" and "every pair of
 * online participants eventually has an open data channel".
 *
 * Scope
 * -----
 * - One {@link SimHub} = one `x-webrtcsig` server instance.
 * - Many {@link SimClient}s share the same hub and the same fake chain
 *   (see {@link SimChain}). Each client owns its own
 *   `ChatDataSessionOrchestrator` + FSM + reconciler.
 * - WebRTC peers are simulated by {@link SimRtcPeer}: when client A
 *   creates a peer for B and B creates one for A, the pair auto-links
 *   and both data channels open atomically. Outbound chat messages on
 *   one side are delivered as inbound on the other.
 * - Time is controlled via `vi.useFakeTimers()` from the test, so we can
 *   advance through transport-recovery timers etc. without sleeping.
 *
 * Out of scope (deliberately)
 * ---------------------------
 * - Real STUN/ICE. We don't simulate ICE at all — the sim just decides
 *   "are both peers willing to talk?" and flips the data channel open.
 * - Bandwidth / packet loss. Messages are delivered in FIFO order with
 *   zero latency. We use `runUntilSettled` to drain microtasks
 *   between actions.
 * - Authoritative chain ledger. {@link SimChain} only tracks the bits
 *   the orchestrator reads (active sessions, members).
 */
import { vi } from "vitest";

import {
    canonicalChatParticipants,
    type ChatSessionEntry,
} from "./chat-api";
import type {
    ChatDataMessageAckEnvelope,
    ChatDataMessageEnvelope,
    ChatHistorySyncEnvelope,
} from "./chat-data-envelope";
import { ChatDataSessionOrchestrator } from "./chat-data-session-orchestrator";
import type {
    ChatDataSessionSnapshot,
    SpaceRun,
} from "./chat-data-session-types";
import type {
    RealtimeClient,
    RealtimeHandlers,
} from "./realtime-client";
import type {
    ClientRealtimeFrame,
    ServerRealtimeFrame,
} from "./realtime-protocol";

/* -------------------------------------------------------------------------- */
/* SimRtcPeer / SimRtcRegistry live in chat-data-session-sim-rtc.ts to break  */
/* the import cycle between vi.mock("./chat-data-webrtc-peer") and the        */
/* orchestrator. Re-exported here for backwards compat with code that         */
/* expects them on this module.                                               */
/* -------------------------------------------------------------------------- */
export {
    SimRtcPeer,
    SimRtcRegistry,
    type SimPeerHandlers,
} from "./chat-data-session-sim-rtc";
import { SimRtcPeer, SimRtcRegistry } from "./chat-data-session-sim-rtc";

/* -------------------------------------------------------------------------- */
/* SimChain: minimal in-memory chain that the orchestrator's chat-api reads   */
/* -------------------------------------------------------------------------- */

export class SimChain {
    private sessionsBySpace = new Map<string, ChatSessionEntry>();

    private autoSessionCounter = 0;

    declareSession(
        spaceUuid: string,
        participants: readonly string[],
        sessionId?: string,
    ): string {
        const id = sessionId ?? `wrtc:sim-${++this.autoSessionCounter}`;
        const sorted = canonicalChatParticipants([...participants]);
        const entry: ChatSessionEntry = {
            session_id: id,
            space_uuid: spaceUuid,
            purpose: "chat-data",
            participants: sorted,
            lifecycle: 1,
            expires_at: 9_999_999_999,
            created_at: 0,
        };
        this.sessionsBySpace.set(spaceUuid, entry);
        return id;
    }

    endSession(spaceUuid: string): void {
        this.sessionsBySpace.delete(spaceUuid);
    }

    activeSession(spaceUuid: string): ChatSessionEntry | null {
        return this.sessionsBySpace.get(spaceUuid) ?? null;
    }

    /** Look up a session by its `wrtc:` id (used by SimHub). */
    findBySessionId(sessionId: string): ChatSessionEntry | null {
        for (const entry of this.sessionsBySpace.values()) {
            if (entry.session_id === sessionId) return entry;
        }
        return null;
    }
}

/* -------------------------------------------------------------------------- */
/* SimHub: in-memory x-webrtcsig server obeying the F1 contract               */
/* -------------------------------------------------------------------------- */

type ClientSocket = {
    account: string;
    onFrame: (frame: ServerRealtimeFrame) => void;
};

type SessionState = {
    spaceUuid: string;
    purpose: string;
    participants: string[];
    joined: Map<string, ClientSocket>; // account -> socket
    pendingSignals: Map<string, ServerRealtimeFrame[]>; // to -> queued signal frames
};

export class SimHub {
    private sockets = new Map<string, ClientSocket>();

    private sessions = new Map<string, SessionState>();

    constructor(private readonly chain: SimChain) {}

    /** A SimClient wires its inbound frame handler here at construction time. */
    connect(account: string, onFrame: (frame: ServerRealtimeFrame) => void): void {
        this.sockets.set(account, { account, onFrame });
    }

    /** Simulate a websocket dying without a clean leave. F1: emit transportLost. */
    disconnect(account: string): void {
        this.sockets.delete(account);
        for (const [sessionId, sess] of this.sessions) {
            if (!sess.joined.has(account)) continue;
            sess.joined.delete(account);
            const transportLost: ServerRealtimeFrame = {
                t: "transportLost",
                sessionId,
                participant: account,
            };
            for (const peer of sess.joined.values()) {
                peer.onFrame(transportLost);
            }
            this.broadcastSnapshot(sessionId);
        }
    }

    /* -------------------- protocol surface (client → server) --------------- */

    handleClientFrame(account: string, frame: ClientRealtimeFrame): void {
        switch (frame.t) {
            case "joinSession":
                this.onJoinSession(account, frame.sessionId);
                return;
            case "leaveSession":
                this.onLeaveSession(account, frame.sessionId, frame.reason);
                return;
            case "signal":
                this.onSignal(account, frame);
                return;
            case "ping":
                this.sockets
                    .get(account)
                    ?.onFrame({ t: "pong" });
                return;
            case "clientReady":
            case "participantState":
                return;
        }
    }

    /* ------------------------- server-side machinery ----------------------- */

    private getOrCreateSessionState(sessionId: string): SessionState | null {
        let sess = this.sessions.get(sessionId);
        if (sess) return sess;
        const entry = this.chain.findBySessionId(sessionId);
        if (!entry) return null;
        sess = {
            spaceUuid: entry.space_uuid,
            purpose: entry.purpose,
            participants: [...entry.participants],
            joined: new Map(),
            pendingSignals: new Map(),
        };
        this.sessions.set(sessionId, sess);
        return sess;
    }

    private onJoinSession(account: string, sessionId: string): void {
        const sock = this.sockets.get(account);
        if (!sock) return;
        const sess = this.getOrCreateSessionState(sessionId);
        if (!sess) {
            sock.onFrame({
                t: "error",
                code: "unknown-session",
                reason: "unknown session",
                sessionId,
            });
            return;
        }
        if (!sess.participants.includes(account)) {
            sock.onFrame({
                t: "error",
                code: "not-participant",
                reason: "not a participant",
                sessionId,
            });
            return;
        }
        const prior = sess.joined.get(account);
        const duplicateSameSocket = prior === sock;
        sess.joined.set(account, sock);

        // 1. sessionInvite to joiner.
        sock.onFrame({
            t: "sessionInvite",
            sessionId,
            appService: "chat",
            appSessionId: sess.spaceUuid,
            purpose: "chat-data",
            from: account,
            participants: [...sess.participants],
            transports: [],
            dataChannels: [{ label: "chat", ordered: true }],
            expiresAt: 9_999_999_999,
            appMetadata: { spaceUuid: sess.spaceUuid },
        });

        // 2. Flush buffered signals targeted at this joiner.
        const pending = sess.pendingSignals.get(account);
        if (pending && pending.length > 0) {
            for (const f of pending) sock.onFrame(f);
            sess.pendingSignals.delete(account);
        }

        if (duplicateSameSocket) {
            // Mirror production x-webrtcsig: duplicate joinSession on the
            // same socket re-sends invite + snapshot only to the joiner.
            this.broadcastSnapshotToAccount(sessionId, account);
            return;
        }

        // 3. participantJoined to every other joined socket.
        for (const [otherAcc, otherSock] of sess.joined) {
            if (otherAcc === account) continue;
            otherSock.onFrame({
                t: "participantJoined",
                sessionId,
                participant: account,
            });
        }

        // 4. sessionInvite to other participants' live sockets (mirrors
        //    the real server fan-out so late-joining clients learn about
        //    sessions started by others). Skip if they're already joined.
        for (const participant of sess.participants) {
            if (participant === account) continue;
            if (sess.joined.has(participant)) continue;
            const live = this.sockets.get(participant);
            if (!live) continue;
            live.onFrame({
                t: "sessionInvite",
                sessionId,
                appService: "chat",
                appSessionId: sess.spaceUuid,
                purpose: "chat-data",
                from: account,
                participants: [...sess.participants],
                transports: [],
                dataChannels: [{ label: "chat", ordered: true }],
                expiresAt: 9_999_999_999,
                appMetadata: { spaceUuid: sess.spaceUuid },
            });
        }

        // 5. F1: broadcast sessionSnapshot to every joined socket.
        this.broadcastSnapshot(sessionId);
    }

    private onLeaveSession(
        account: string,
        sessionId: string,
        reason: string | undefined,
    ): void {
        const sess = this.sessions.get(sessionId);
        if (!sess) return;
        if (!sess.joined.has(account)) return;
        sess.joined.delete(account);
        const ended: ServerRealtimeFrame = {
            t: "sessionEnded",
            sessionId,
            by: account,
            reason: reason ?? "user",
        };
        for (const otherSock of sess.joined.values()) {
            otherSock.onFrame(ended);
        }
        const selfSock = this.sockets.get(account);
        selfSock?.onFrame(ended);
        this.broadcastSnapshot(sessionId);
    }

    private onSignal(
        account: string,
        frame: Extract<ClientRealtimeFrame, { t: "signal" }>,
    ): void {
        const sess = this.sessions.get(frame.sessionId);
        if (!sess) return;
        if (!sess.joined.has(account)) return;
        if (!sess.participants.includes(frame.to)) return;
        const outbound: ServerRealtimeFrame = {
            t: "signal",
            sessionId: frame.sessionId,
            from: account,
            to: frame.to,
            kind: frame.kind,
            sdp: frame.sdp,
            candidate: frame.candidate,
            sdpMid: frame.sdpMid,
            sdpMLineIndex: frame.sdpMLineIndex,
        };
        const target = sess.joined.get(frame.to);
        if (target) {
            target.onFrame(outbound);
        } else {
            const queue = sess.pendingSignals.get(frame.to) ?? [];
            queue.push(outbound);
            sess.pendingSignals.set(frame.to, queue);
        }
    }

    private broadcastSnapshot(sessionId: string): void {
        const sess = this.sessions.get(sessionId);
        if (!sess) return;
        const joinedList = sess.participants.filter((p) =>
            sess.joined.has(p),
        );
        const pendingList = sess.participants.filter(
            (p) => !sess.joined.has(p),
        );
        const snapshot: ServerRealtimeFrame = {
            t: "sessionSnapshot",
            sessionId,
            epoch: joinedList.length,
            joinedParticipants: joinedList,
            pendingParticipants: pendingList,
        };
        for (const sock of sess.joined.values()) {
            sock.onFrame(snapshot);
        }
    }

    private broadcastSnapshotToAccount(
        sessionId: string,
        account: string,
    ): void {
        const sess = this.sessions.get(sessionId);
        if (!sess) return;
        const sock = sess.joined.get(account);
        if (!sock) return;
        const joinedList = sess.participants.filter((p) =>
            sess.joined.has(p),
        );
        const pendingList = sess.participants.filter(
            (p) => !sess.joined.has(p),
        );
        sock.onFrame({
            t: "sessionSnapshot",
            sessionId,
            epoch: joinedList.length,
            joinedParticipants: joinedList,
            pendingParticipants: pendingList,
        });
    }
}

/* -------------------------------------------------------------------------- */
/* SimClient: orchestrator-driven client wired into the SimHub                */
/* -------------------------------------------------------------------------- */

/**
 * Fake realtime client that talks to the SimHub instead of a real WS.
 * Conforms to the surface the chat-data orchestrator uses (a subset of
 * the actual RealtimeClient).
 */
export class SimRealtimeClient {
    instanceId: string;

    isSessionReady = true;

    welcomeCount = 1;

    handlers: RealtimeHandlers = {};

    constructor(
        public readonly account: string,
        private readonly hub: SimHub,
    ) {
        this.instanceId = `rt-sim-${account}`;
        this.hub.connect(account, (frame) => this.deliverFrame(frame));
    }

    registerHandlers(extra: RealtimeHandlers): void {
        type HandlerFn = (frame: ServerRealtimeFrame) => void;
        const merged: Record<string, HandlerFn | undefined> = {
            ...(this.handlers as Record<string, HandlerFn | undefined>),
        };
        for (const key of Object.keys(extra) as (keyof RealtimeHandlers)[]) {
            const next = extra[key] as HandlerFn | undefined;
            if (!next) continue;
            const prev = merged[key as string];
            merged[key as string] = prev
                ? (frame) => {
                      prev(frame);
                      next(frame);
                  }
                : next;
        }
        this.handlers = merged as RealtimeHandlers;
    }

    sendClientFrame(frame: ClientRealtimeFrame): void {
        this.hub.handleClientFrame(this.account, frame);
    }

    isReconnectWelcome(): boolean {
        return this.welcomeCount > 1;
    }

    get welcomeGeneration(): number {
        return this.welcomeCount;
    }

    /** Disconnect the underlying socket — simulates browser tab close. */
    disconnect(): void {
        this.hub.disconnect(this.account);
    }

    /**
     * Simulate a websocket reconnect on the same tab: the hub drops the old
     * socket (server-side join row cleared) and the client opens a fresh one.
     * Does not reset the orchestrator — mirrors RealtimeClient reconnect.
     */
    reconnectTransport(): void {
        this.hub.disconnect(this.account);
        this.welcomeCount += 1;
        this.hub.connect(this.account, (frame) => this.deliverFrame(frame));
    }

    private deliverFrame(frame: ServerRealtimeFrame): void {
        const handler = (this.handlers as Record<string, unknown>)[frame.t];
        if (typeof handler === "function") {
            (handler as (f: ServerRealtimeFrame) => void)(frame);
        }
    }
}

export type SimClientOptions = {
    iceServers?: Array<{ urls: string | string[] }>;
};

export type SimReceivedMessage = {
    spaceUuid: string;
    envelope: ChatDataMessageEnvelope;
};

/**
 * One simulated user. Owns a SimRealtimeClient + ChatDataSessionOrchestrator.
 * Tests drive this with `connectChat` / `sendChatMessage` and assert on
 * `receivedMessages` and `getSnapshot`.
 */
export class SimClient {
    readonly realtime: SimRealtimeClient;

    readonly orchestrator: ChatDataSessionOrchestrator;

    readonly received: SimReceivedMessage[] = [];

    /**
     * Plan F7: ack envelopes received as a sender. One entry per
     * `messageAck` envelope inbound to this client, in arrival order.
     */
    readonly receivedAcks: Array<{
        spaceUuid: string;
        envelope: ChatDataMessageAckEnvelope;
    }> = [];

    private presence: Record<string, string> = {};

    constructor(
        public readonly account: string,
        hub: SimHub,
        opts: SimClientOptions = {},
    ) {
        this.realtime = new SimRealtimeClient(account, hub);
        this.orchestrator = new ChatDataSessionOrchestrator(
            () => this.realtime as unknown as RealtimeClient,
            () => this.account,
            () => opts.iceServers ?? [],
            () => this.presence,
            undefined,
            (spaceUuid, envelope) => {
                this.received.push({ spaceUuid, envelope });
            },
            undefined,
            undefined,
            undefined,
            undefined,
            (spaceUuid, envelope) => {
                this.receivedAcks.push({ spaceUuid, envelope });
            },
        );
        this.orchestrator.start((handlers) => {
            this.realtime.registerHandlers(handlers);
            return () => {
                for (const key of Object.keys(
                    handlers,
                ) as (keyof RealtimeHandlers)[]) {
                    delete (this.realtime.handlers as Record<string, unknown>)[
                        key as string
                    ];
                }
            };
        });
    }

    setPresence(account: string, status: "online" | "offline"): void {
        this.presence = { ...this.presence, [account]: status };
        if (status === "online") this.orchestrator.onPeerOnline(account);
        else this.orchestrator.onPeerOffline(account);
    }

    /** Mark every other account in `participants` as online for this client. */
    setEveryoneOnlineExceptSelf(participants: readonly string[]): void {
        const next: Record<string, string> = {};
        for (const p of participants) {
            if (p === this.account) continue;
            next[p] = "online";
        }
        this.presence = next;
        for (const p of participants) {
            if (p === this.account) continue;
            this.orchestrator.onPeerOnline(p);
        }
    }

    ensureChat(spaceUuid: string, members: readonly string[]): void {
        this.orchestrator.ensureChatDataSession(spaceUuid, members);
    }

    getSnapshot(spaceUuid: string): ChatDataSessionSnapshot {
        return this.orchestrator.getSnapshot(spaceUuid);
    }

    /** Underlying SpaceRun. Useful for asserting roster contents. */
    getRun(spaceUuid: string): SpaceRun | undefined {
        return (
            this.orchestrator as unknown as {
                runs: Map<string, SpaceRun>;
            }
        ).runs.get(spaceUuid);
    }

    /**
     * Best-effort send via the orchestrator's underlying peers. F5 doesn't
     * model the outbox/pending message store — that's tested separately;
     * here we just exercise the on-the-wire delivery.
     */
    sendChatMessage(
        spaceUuid: string,
        recipient: string,
        body: string,
    ): boolean {
        const run = this.getRun(spaceUuid);
        if (!run) return false;
        const peer =
            run.kind === "dm"
                ? run.peerAccount === recipient
                    ? run.peer
                    : null
                : run.meshPeers.get(recipient) ?? null;
        if (!peer || !peer.dataChannelReady) return false;
        const envelope: ChatDataMessageEnvelope = {
            t: "chatMessage",
            spaceUuid,
            from: this.account,
            body,
            sendTimestamp: Date.now(),
            clientMsgId: `m-${this.account}-${Date.now()}`,
        };
        return (peer as unknown as SimRtcPeer).sendChatMessage(envelope);
    }

    disconnect(): void {
        this.realtime.disconnect();
    }

    /** WS reconnect on the same orchestrator (not a full tab close). */
    reconnectTransport(): void {
        this.realtime.reconnectTransport();
        this.orchestrator.reconcileAfterReconnect();
    }
}

/* -------------------------------------------------------------------------- */
/* SessionSim: top-level convenience wrapper                                  */
/* -------------------------------------------------------------------------- */

/**
 * The full harness. Each test does:
 *
 *   const sim = await SessionSim.create({ participants: ["alice","bob","carol"] });
 *   sim.declareSession("space:g", ["alice","bob","carol"], "wrtc:g");
 *   sim.client("alice").ensureChat("space:g", ["alice","bob","carol"]);
 *   sim.client("bob").ensureChat("space:g", ["alice","bob","carol"]);
 *   sim.client("carol").ensureChat("space:g", ["alice","bob","carol"]);
 *   await sim.runUntilSettled();
 *   expect(sim.client("alice").getSnapshot("space:g").phase).toBe("ready");
 *
 * The sim relies on `vi.useFakeTimers()` — tests must opt in.
 */
export type SessionSimSetup = {
    participants: readonly string[];
    /** ICE servers reported in the fake welcome. */
    iceServers?: Array<{ urls: string | string[] }>;
};

export class SessionSim {
    readonly chain = new SimChain();

    readonly hub = new SimHub(this.chain);

    readonly registry = new SimRtcRegistry();

    private clients = new Map<string, SimClient>();

    private constructor(private readonly setup: SessionSimSetup) {}

    static async create(setup: SessionSimSetup): Promise<SessionSim> {
        return new SessionSim(setup);
    }

    client(account: string): SimClient {
        let c = this.clients.get(account);
        if (c) return c;
        c = new SimClient(account, this.hub, {
            iceServers: this.setup.iceServers,
        });
        this.clients.set(account, c);
        return c;
    }

    allClients(): SimClient[] {
        return [...this.clients.values()];
    }

    /**
     * Simulate a user closing their browser tab and opening a new one:
     * drops the existing client (socket dies → hub emits `transportLost`)
     * and forgets it so the next `client(account)` call returns a fresh
     * orchestrator + socket. Returns the fresh client.
     */
    closeTab(account: string): SimClient {
        const existing = this.clients.get(account);
        if (existing) {
            existing.disconnect();
            this.clients.delete(account);
        }
        return this.client(account);
    }

    /**
     * Pre-declare a session on the fake chain. Returns the assigned
     * sessionId so the test can refer to it.
     */
    declareSession(
        spaceUuid: string,
        participants: readonly string[],
        sessionId?: string,
    ): string {
        return this.chain.declareSession(spaceUuid, participants, sessionId);
    }

    /**
     * Drain pending microtasks + advance fake timers in small increments
     * until either nothing happens for a quiet period (the system has
     * settled) or `maxAdvanceMs` has been reached. Pair this with
     * `vi.useFakeTimers()` in the test.
     *
     * "Settled" is detected by snapshotting every client's phase +
     * dataChannelReady state and exiting when it stops changing for
     * `quietWindowMs` of sim time.
     */
    async runUntilSettled(
        maxAdvanceMs = 2_000,
        quietWindowMs = 200,
    ): Promise<void> {
        const step = 25;
        let elapsed = 0;
        let lastFingerprint = this.fingerprintAllClients();
        let quietElapsed = 0;
        while (elapsed < maxAdvanceMs) {
            for (let i = 0; i < 8; i++) {
                await Promise.resolve();
            }
            await vi.advanceTimersByTimeAsync(step);
            elapsed += step;
            const next = this.fingerprintAllClients();
            if (next === lastFingerprint) {
                quietElapsed += step;
                if (quietElapsed >= quietWindowMs) break;
            } else {
                quietElapsed = 0;
                lastFingerprint = next;
            }
        }
        for (let i = 0; i < 8; i++) {
            await Promise.resolve();
        }
    }

    private fingerprintAllClients(): string {
        const parts: string[] = [];
        for (const c of this.clients.values()) {
            const runs = (
                c.orchestrator as unknown as {
                    runs: Map<string, SpaceRun>;
                }
            ).runs;
            for (const [space, run] of runs) {
                parts.push(
                    `${c.account}|${space}|${run.snapshot.phase}|${
                        run.snapshot.dataChannelReady ? "ok" : "no"
                    }|${JSON.stringify(run.snapshot.meshPeerReady ?? {})}`,
                );
            }
        }
        return parts.sort().join("##");
    }
}
