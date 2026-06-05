import {
    parseChatDataWireEnvelope,
    type ChatDataMessageAckEnvelope,
    type ChatDataMessageEnvelope,
    type ChatDataWireEnvelope,
    type ChatHistorySyncEnvelope,
} from "../lib/chat-data-envelope";
import { ChatDataWebRtcPeer } from "../lib/chat-data-webrtc-peer";
import type { IceServerConfig } from "../lib/protocol";
import type {
    SignalKind,
    WebRtcSignalingClient,
} from "../lib/webrtc-signaling-client";
import { EventBus } from "./event-bus";
import { isLexInitiator, pairSessionId } from "./pair-id";
import type { RealtimeTransport } from "./l1-realtime-transport";
import type { PairSignaling } from "./l2-pair-signaling";
import {
    PEER_IDLE_TTL_MS,
    PEER_MAX_WARM,
    type EnsureReason,
    type PeerState,
    type SendResult,
    type Unsubscribe,
} from "./types";

type PeerRegistryEvents = {
    usable: (remote: string) => void;
    suspected_dead: (remote: string) => void;
    disposed: (remote: string) => void;
};

export interface PeerTransportRegistry {
    ensure(remoteAccount: string, reason: EnsureReason): Promise<void>;
    getState(remoteAccount: string): PeerState;
    send(remoteAccount: string, bytes: Uint8Array): SendResult;
    on(
        event: keyof PeerRegistryEvents,
        handler: PeerRegistryEvents[keyof PeerRegistryEvents],
    ): Unsubscribe;
    ping(remoteAccount: string): Promise<boolean>;
    touch(remoteAccount: string): void;
    dispose(remoteAccount: string, reason: string): void;
    handleRemoteSignal(
        remoteAccount: string,
        frame: {
            from?: string;
            kind: SignalKind;
            sdp?: string;
            candidate?: string;
            sdpMid?: string;
            sdpMLineIndex?: number;
        },
    ): Promise<void>;
    /** Underlying pair PC for Meet track add/remove on same connection. */
    getChatPeer(remoteAccount: string): ChatDataWebRtcPeer | null;
    /** Prevent idle TTL dispose while Meet holds the pair PC. */
    holdMeet(remoteAccount: string): void;
    releaseMeet(remoteAccount: string): void;
}

type PeerEntry = {
    remote: string;
    pairId: string;
    state: PeerState;
    lastUsedAt: number;
    peer: ChatDataWebRtcPeer | null;
    ensureWaiters: Array<() => void>;
    dataChannelReady: boolean;
    meetHoldCount: number;
    pendingRemoteSignals: Array<{
        from?: string;
        kind: SignalKind;
        sdp?: string;
        candidate?: string;
        sdpMid?: string;
        sdpMLineIndex?: number;
    }>;
};

export type PeerTransportRegistryOptions = {
    localAccount: string;
    realtime: RealtimeTransport;
    pairSignaling: PairSignaling;
    signaling: WebRtcSignalingClient;
    iceServers: IceServerConfig[] | null;
    onInboundBytes?: (remote: string, bytes: Uint8Array) => void;
};

export function createPeerTransportRegistry(
    opts: PeerTransportRegistryOptions,
): PeerTransportRegistry {
    const bus = new EventBus<PeerRegistryEvents>();
    const entries = new Map<string, PeerEntry>();

    const touchEntry = (entry: PeerEntry) => {
        entry.lastUsedAt = Date.now();
    };

    const pruneIdle = () => {
        const now = Date.now();
        for (const [remote, entry] of entries) {
            if (entry.meetHoldCount > 0) continue;
            if (
                entry.state === "usable" &&
                now - entry.lastUsedAt >= PEER_IDLE_TTL_MS
            ) {
                disposeEntry(remote, "idle_ttl");
            }
        }
        if (entries.size <= PEER_MAX_WARM) return;
        const candidates = [...entries.entries()]
            .filter(([, e]) => e.state === "usable" && e.meetHoldCount === 0)
            .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
        while (entries.size > PEER_MAX_WARM && candidates.length > 0) {
            const [remote] = candidates.shift()!;
            disposeEntry(remote, "lru_cap");
        }
    };

    const setState = (entry: PeerEntry, state: PeerState) => {
        entry.state = state;
    };

    const resolveEnsureWaiters = (entry: PeerEntry) => {
        if (entry.state !== "usable") return;
        const waiters = entry.ensureWaiters.splice(0);
        for (const resolve of waiters) resolve();
    };

    const disposeEntry = (remote: string, reason: string) => {
        const entry = entries.get(remote);
        if (!entry || entry.state === "disposing") return;
        if (entry.meetHoldCount > 0 && reason !== "force") return;
        setState(entry, "disposing");
        entry.peer?.stopMeetMedia();
        entry.peer?.dispose();
        entry.peer = null;
        entries.delete(remote);
        opts.pairSignaling.leavePair(entry.pairId, reason);
        bus.emit("disposed", remote);
    };

    const beginNegotiation = (entry: PeerEntry) => {
        if (entry.peer) return;
        if (!opts.realtime.isReady) {
            setState(entry, "waiting_ws");
            return;
        }
        if (!opts.pairSignaling.isJoined(entry.pairId)) {
            opts.pairSignaling.joinPair(opts.localAccount, entry.remote);
            setState(entry, "negotiating");
            return;
        }

        setState(entry, "negotiating");
        const impolite = isLexInitiator(opts.localAccount, entry.remote);
        entry.peer = new ChatDataWebRtcPeer({
            sessionId: entry.pairId,
            selfAccount: opts.localAccount,
            peerAccount: entry.remote,
            iceServers: opts.iceServers,
            signaling: opts.signaling,
            isInitiator: impolite,
            impolite,
            handlers: {
                onDataChannelOpen: () => {
                    entry.dataChannelReady = true;
                    setState(entry, "usable");
                    touchEntry(entry);
                    resolveEnsureWaiters(entry);
                    bus.emit("usable", entry.remote);
                },
                onChatMessage: (envelope: ChatDataMessageEnvelope) => {
                    touchEntry(entry);
                    opts.onInboundBytes?.(
                        entry.remote,
                        new TextEncoder().encode(JSON.stringify(envelope)),
                    );
                },
                onMessageAck: (envelope: ChatDataMessageAckEnvelope) => {
                    touchEntry(entry);
                    opts.onInboundBytes?.(
                        entry.remote,
                        new TextEncoder().encode(JSON.stringify(envelope)),
                    );
                },
                onChatHistorySync: (envelope: ChatHistorySyncEnvelope) => {
                    touchEntry(entry);
                    opts.onInboundBytes?.(
                        entry.remote,
                        new TextEncoder().encode(JSON.stringify(envelope)),
                    );
                },
                onTransportLost: () => {
                    entry.dataChannelReady = false;
                    setState(entry, "suspected_dead");
                    entry.peer?.dispose();
                    entry.peer = null;
                    bus.emit("suspected_dead", entry.remote);
                },
                onFailed: () => {
                    entry.dataChannelReady = false;
                    setState(entry, "suspected_dead");
                    entry.peer?.dispose();
                    entry.peer = null;
                    bus.emit("suspected_dead", entry.remote);
                },
            },
        });
        void flushPendingRemoteSignals(entry);
    };

    const flushPendingRemoteSignals = async (entry: PeerEntry) => {
        const peer = entry.peer;
        if (!peer || entry.pendingRemoteSignals.length === 0) return;
        const pending = entry.pendingRemoteSignals.splice(0);
        for (const frame of pending) {
            await peer.handleRemoteSignal(frame);
        }
    };

    const getOrCreateEntry = (remote: string): PeerEntry => {
        let entry = entries.get(remote);
        if (!entry) {
            entry = {
                remote,
                pairId: pairSessionId(opts.localAccount, remote),
                state: "absent",
                lastUsedAt: Date.now(),
                peer: null,
                ensureWaiters: [],
                dataChannelReady: false,
                meetHoldCount: 0,
                pendingRemoteSignals: [],
            };
            entries.set(remote, entry);
            pruneIdle();
        }
        return entry;
    };

    opts.realtime.on("ready", () => {
        for (const entry of entries.values()) {
            if (
                entry.state === "waiting_ws" ||
                entry.state === "negotiating" ||
                entry.state === "suspected_dead"
            ) {
                beginNegotiation(entry);
            }
        }
    });

    opts.pairSignaling.on("pairJoined", (pairId: string) => {
        for (const entry of entries.values()) {
            if (entry.pairId === pairId && entry.state !== "usable") {
                beginNegotiation(entry);
            }
        }
    });

    return {
        ensure(remoteAccount, _reason) {
            const entry = getOrCreateEntry(remoteAccount);
            touchEntry(entry);
            if (entry.state === "usable") {
                return Promise.resolve();
            }
            if (entry.state === "absent" || entry.state === "suspected_dead") {
                setState(entry, "negotiating");
                beginNegotiation(entry);
            }
            if (entries.get(remoteAccount)?.state === "usable") {
                return Promise.resolve();
            }
            return new Promise<void>((resolve) => {
                entry.ensureWaiters.push(resolve);
            });
        },

        getState(remoteAccount) {
            return entries.get(remoteAccount)?.state ?? "absent";
        },

        send(remoteAccount, bytes) {
            if (!opts.realtime.isReady) {
                return { ok: false, reason: "ws_not_ready" };
            }
            const entry = entries.get(remoteAccount);
            if (!entry || entry.state !== "usable" || !entry.peer) {
                return { ok: false, reason: "peer_not_ready" };
            }
            const text = new TextDecoder().decode(bytes);
            const envelope = parseChatDataWireEnvelope(text);
            if (!envelope) {
                return { ok: false, reason: "peer_not_ready" };
            }
            let ok = false;
            if (envelope.t === "chatMessage") {
                ok = entry.peer.sendChatMessage(envelope);
            } else if (envelope.t === "chatHistorySync") {
                ok = entry.peer.sendHistorySync(envelope);
            } else if (envelope.t === "messageAck") {
                ok = entry.peer.sendMessageAck(envelope);
            }
            if (ok) touchEntry(entry);
            return ok
                ? { ok: true }
                : { ok: false, reason: "peer_not_ready" };
        },

        on(event, handler) {
            return bus.on(event, handler as PeerRegistryEvents[typeof event]);
        },

        async ping(remoteAccount) {
            const entry = entries.get(remoteAccount);
            if (!entry || entry.state !== "usable") return false;
            return entry.dataChannelReady;
        },

        touch(remoteAccount) {
            const entry = entries.get(remoteAccount);
            if (entry) touchEntry(entry);
        },

        dispose(remoteAccount, reason) {
            disposeEntry(remoteAccount, reason);
        },

        async handleRemoteSignal(remoteAccount, frame) {
            const entry = getOrCreateEntry(remoteAccount);
            if (!entry.peer) {
                entry.pendingRemoteSignals.push(frame);
                beginNegotiation(entry);
            }
            const peer = entries.get(remoteAccount)?.peer;
            if (peer) {
                if (entry.pendingRemoteSignals.length > 0) {
                    await flushPendingRemoteSignals(entry);
                } else {
                    await peer.handleRemoteSignal(frame);
                }
            }
        },

        getChatPeer(remoteAccount) {
            return entries.get(remoteAccount)?.peer ?? null;
        },

        holdMeet(remoteAccount) {
            const entry = getOrCreateEntry(remoteAccount);
            entry.meetHoldCount += 1;
            touchEntry(entry);
        },

        releaseMeet(remoteAccount) {
            const entry = entries.get(remoteAccount);
            if (!entry) return;
            entry.meetHoldCount = Math.max(0, entry.meetHoldCount - 1);
            touchEntry(entry);
        },
    };
}

export type { PeerRegistryEvents };
