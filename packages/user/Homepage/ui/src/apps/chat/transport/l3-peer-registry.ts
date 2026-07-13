import type { IceServerConfig } from "../lib/protocol";
import type {
    SignalKind,
    WebRtcSignalingClient,
} from "../lib/webrtc-signaling-client";
import type { RealtimeTransport } from "./l1-realtime-transport";
import type { PairSignaling } from "./l2-pair-signaling";
import type { PeerRosterSnapshot } from "./roster-renegotiation-coordinator";

import { chatDataRecord } from "../lib/chat-data-debug";
import {
    type ChatDataMessageAckEnvelope,
    type ChatDataMessageEnvelope,
    type ChatDataWireEnvelope,
    type ChatHistorySyncEnvelope,
    parseChatDataWireEnvelope,
} from "../lib/chat-data-envelope";
import { ChatDataWebRtcPeer } from "../lib/chat-data-webrtc-peer";
import { recordTransportLifecycle } from "../lib/thread-lifecycle";
import { EventBus } from "./event-bus";
import { createNegotiationScheduler } from "./negotiation-scheduler";
import { isLexInitiator, pairSessionId } from "./pair-id";
import {
    type EnsureReason,
    PEER_ESTABLISHING_STUCK_MS,
    PEER_IDLE_TTL_MS,
    PEER_JOIN_STUCK_MS,
    PEER_MAX_WARM,
    PEER_NEGOTIATION_STUCK_MS,
    PEER_STUCK_CHECK_MS,
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
    /** Re-drive join/negotiation when roster shows a remote is reachable. */
    kickNegotiation(remoteAccount: string): void;
    getRosterSnapshot(remoteAccount: string): PeerRosterSnapshot | null;
    resendOffer(remoteAccount: string): void;
    retriggerHandshake(remoteAccount: string): void;
    recoverPeer(remoteAccount: string, reason: string): void;
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
    getKickCounts(): Readonly<Record<string, number>>;
    resetKickCounts(): void;
}

type PeerEntry = {
    remote: string;
    pairId: string;
    state: PeerState;
    lastUsedAt: number;
    joinRequestedAt: number;
    negotiationStartedAt: number | null;
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
    onSpaceMembershipHint?: (remote: string) => void;
};

export function createPeerTransportRegistry(
    opts: PeerTransportRegistryOptions,
): PeerTransportRegistry {
    const bus = new EventBus<PeerRegistryEvents>();
    const entries = new Map<string, PeerEntry>();
    const kickCounts = new Map<string, number>();
    const negotiationScheduler = createNegotiationScheduler();

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

    const setState = (
        entry: PeerEntry,
        state: PeerState,
        negotiationPhase?: string,
    ) => {
        if (entry.state === state) return;
        const detail = {
            remote: entry.remote,
            pairId: entry.pairId,
            from: entry.state,
            to: state,
            negotiationPhase: negotiationPhase ?? state,
            dataChannelReady: entry.dataChannelReady,
            hasPeer: entry.peer != null,
        };
        chatDataRecord("peer-registry-state", detail);
        recordTransportLifecycle("l3", "state", detail);
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
        setState(entry, "disposing", "dispose");
        entry.peer?.stopMeetMedia();
        entry.peer?.dispose();
        entry.peer = null;
        entries.delete(remote);
        negotiationScheduler.release(remote);
        opts.pairSignaling.leavePair(entry.pairId, reason);
        bus.emit("disposed", remote);
    };

    const recoverStuckPeer = (entry: PeerEntry, reason: string) => {
        const peer = entry.peer;
        chatDataRecord("peer-registry-recover", {
            remote: entry.remote,
            pairId: entry.pairId,
            reason,
            polite: peer ? !peer.sendsInitialOffer : undefined,
            needsReconnect: peer?.needsReconnect ?? null,
            transport: peer?.transportSnapshot ?? null,
        });
        recordTransportLifecycle("l3", "recover", {
            remote: entry.remote,
            pairId: entry.pairId,
            reason,
            polite: peer ? !peer.sendsInitialOffer : undefined,
            transport: peer?.transportSnapshot ?? null,
        });
        peer?.dispose();
        entry.peer = null;
        entry.dataChannelReady = false;
        entry.negotiationStartedAt = null;
        negotiationScheduler.release(entry.remote);
        setState(entry, "suspected_dead", reason);
        bus.emit("suspected_dead", entry.remote);
        requestNegotiation(entry, "manual");
    };

    const createPeerForEntry = (entry: PeerEntry) => {
        const impolite = isLexInitiator(opts.localAccount, entry.remote);
        // Locked policy: lex-lower side is offer initiator + Perfect
        // Negotiation impolite role (not roster join order).
        const pairSignaling = opts.pairSignaling;
        const routedSignaling = {
            signal: (
                payload: Parameters<WebRtcSignalingClient["signal"]>[0],
            ) => {
                pairSignaling.signal(entry.pairId, payload);
            },
        } as WebRtcSignalingClient;
        entry.negotiationStartedAt = Date.now();
        entry.peer = new ChatDataWebRtcPeer({
            sessionId: entry.pairId,
            selfAccount: opts.localAccount,
            peerAccount: entry.remote,
            iceServers: opts.iceServers,
            signaling: routedSignaling,
            isInitiator: impolite,
            impolite,
            handlers: {
                onDataChannelOpen: () => {
                    entry.dataChannelReady = true;
                    setState(entry, "usable", "dc_open");
                    negotiationScheduler.release(entry.remote);
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
                onSpaceMembershipHint: () => {
                    touchEntry(entry);
                    opts.onSpaceMembershipHint?.(entry.remote);
                },
                onChatHistorySync: (envelope: ChatHistorySyncEnvelope) => {
                    touchEntry(entry);
                    opts.onInboundBytes?.(
                        entry.remote,
                        new TextEncoder().encode(JSON.stringify(envelope)),
                    );
                },
                // Route through recoverStuckPeer so the scheduler slot is
                // released and a fresh negotiation is requested. Parking the
                // entry in suspected_dead without re-driving it (and with the
                // slot leaked) wedges the remote permanently once the roster
                // kick fan-out no longer exists.
                onTransportLost: () => {
                    recoverStuckPeer(entry, "transport_lost");
                },
                onFailed: () => {
                    recoverStuckPeer(entry, "pc_failed");
                },
            },
        });
    };

    const releaseNegotiationSlotIfIdle = (entry: PeerEntry) => {
        if (
            entry.state === "waiting_ws" ||
            entry.state === "usable" ||
            entry.state === "absent" ||
            entry.state === "disposing" ||
            entry.state === "suspected_dead"
        ) {
            negotiationScheduler.release(entry.remote);
        }
    };

    const beginNegotiation = (entry: PeerEntry) => {
        if (entry.peer) return;
        if (!opts.pairSignaling.isRealtimeReady(entry.pairId)) {
            setState(entry, "waiting_ws", "awaiting_l1_ready");
            return;
        }
        if (entry.remote === opts.localAccount) return;
        opts.pairSignaling.ensureActivePair(opts.localAccount, entry.remote);
        if (!opts.pairSignaling.isJoined(entry.pairId)) {
            opts.pairSignaling.joinPair(opts.localAccount, entry.remote);
            entry.joinRequestedAt = Date.now();
            setState(entry, "joining_pair", "awaiting_l2_join");
            return;
        }

        setState(entry, "negotiating", "pc_handshake");
        createPeerForEntry(entry);
        void flushPendingRemoteSignals(entry);
    };

    const requestNegotiation = (entry: PeerEntry, reason: EnsureReason) => {
        if (
            entry.state === "joining_pair" ||
            entry.state === "negotiating" ||
            entry.state === "usable"
        ) {
            return;
        }
        negotiationScheduler.schedule(entry.remote, reason, () => {
            beginNegotiation(entry);
            releaseNegotiationSlotIfIdle(entry);
        });
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
            const now = Date.now();
            entry = {
                remote,
                pairId: pairSessionId(opts.localAccount, remote),
                state: "absent",
                lastUsedAt: now,
                joinRequestedAt: now,
                negotiationStartedAt: null,
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

    const isTransportEstablishing = (peer: NonNullable<PeerEntry["peer"]>) => {
        const snap = peer.transportSnapshot;
        if (snap.dataChannelReady) return false;
        if (snap.negotiationInProgress) return true;
        if (snap.iceConnectionState === "checking") return true;
        if (
            snap.iceConnectionState === "connected" &&
            snap.connectionState !== "connected"
        ) {
            return true;
        }
        return snap.connectionState === "connecting";
    };

    const checkStuckPeers = () => {
        const now = Date.now();
        for (const entry of entries.values()) {
            if (entry.state === "usable" || entry.state === "disposing") {
                continue;
            }

            if (entry.state === "joining_pair" && !entry.peer) {
                if (now - entry.joinRequestedAt >= PEER_JOIN_STUCK_MS) {
                    chatDataRecord("peer-registry-stuck", {
                        remote: entry.remote,
                        reason: "joining_pair_timeout",
                        ageMs: now - entry.joinRequestedAt,
                    });
                    beginNegotiation(entry);
                }
                continue;
            }

            if (entry.state !== "negotiating" || !entry.peer) continue;
            if (entry.dataChannelReady) continue;

            const peer = entry.peer;
            if (peer.negotiationInProgress) {
                entry.negotiationStartedAt = now;
                continue;
            }

            const startedAt = entry.negotiationStartedAt ?? entry.lastUsedAt;
            const ageMs = now - startedAt;
            const establishing = isTransportEstablishing(peer);
            const stuckThreshold = establishing
                ? PEER_ESTABLISHING_STUCK_MS
                : PEER_NEGOTIATION_STUCK_MS;
            if (peer.needsReconnect || ageMs >= stuckThreshold) {
                recoverStuckPeer(
                    entry,
                    peer.needsReconnect
                        ? "needs-reconnect"
                        : "negotiation-timeout",
                );
            }
        }
    };

    const stuckCheckId =
        typeof setInterval !== "undefined"
            ? setInterval(checkStuckPeers, PEER_STUCK_CHECK_MS)
            : null;
    void stuckCheckId;

    const retryNegotiationOnRealtimeReady = () => {
        for (const entry of entries.values()) {
            if (
                entry.state === "waiting_ws" ||
                entry.state === "suspected_dead"
            ) {
                requestNegotiation(entry, "ws_ready");
                continue;
            }
            if (
                entry.state === "joining_pair" ||
                entry.state === "negotiating"
            ) {
                beginNegotiation(entry);
            }
        }
    };

    opts.realtime.on("ready", retryNegotiationOnRealtimeReady);

    const kickNegotiation = (remoteAccount: string) => {
        kickCounts.set(remoteAccount, (kickCounts.get(remoteAccount) ?? 0) + 1);
        const entry = entries.get(remoteAccount);
        if (!entry) {
            void registryEnsure(remoteAccount, "roster_kick");
            return;
        }
        touchEntry(entry);
        if (entry.state === "usable") return;
        if (!entry.peer) {
            if (
                negotiationScheduler.shouldDeferKick(entry.remote, entry.state)
            ) {
                chatDataRecord("peer-registry-kick-deferred", {
                    remote: entry.remote,
                    state: entry.state,
                });
                return;
            }
            requestNegotiation(entry, "roster_kick");
            return;
        }

        const peer = entry.peer;
        const transport = peer.transportSnapshot;
        chatDataRecord("peer-registry-kick", {
            remote: entry.remote,
            pairId: entry.pairId,
            state: entry.state,
            transport,
        });
        recordTransportLifecycle("l3", "kick", {
            remote: entry.remote,
            pairId: entry.pairId,
            state: entry.state,
            transport,
        });

        // Never tear down an in-progress handshake from a roster kick — the
        // stuck watchdog owns recovery once PEER_NEGOTIATION_STUCK_MS elapses.
        if (peer.sendsInitialOffer) {
            peer.resendOffer();
            return;
        }
        // Polite side: cannot send offers — wait for initiator offer when
        // already joined on L2; only re-join when not yet on server roster.
        if (opts.pairSignaling.isJoined(entry.pairId)) {
            return;
        }
        opts.pairSignaling.joinPair(opts.localAccount, entry.remote);
        touchEntry(entry);
    };

    const registryEnsure = (
        remoteAccount: string,
        _reason: EnsureReason,
    ): Promise<void> => {
        const entry = getOrCreateEntry(remoteAccount);
        touchEntry(entry);
        if (entry.state === "usable") {
            return Promise.resolve();
        }
        if (entry.state === "absent" || entry.state === "suspected_dead") {
            requestNegotiation(entry, _reason);
        } else if (entry.state === "waiting_ws") {
            requestNegotiation(entry, _reason);
        }
        if (entries.get(remoteAccount)?.state === "usable") {
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            entry.ensureWaiters.push(resolve);
        });
    };

    opts.pairSignaling.on("pairJoined", (pairId: string) => {
        for (const entry of entries.values()) {
            if (entry.pairId !== pairId || entry.state === "usable") continue;
            beginNegotiation(entry);
        }
    });

    return {
        ensure(remoteAccount, reason) {
            return registryEnsure(remoteAccount, reason);
        },

        kickNegotiation(remoteAccount) {
            kickNegotiation(remoteAccount);
        },

        getState(remoteAccount) {
            return entries.get(remoteAccount)?.state ?? "absent";
        },

        send(remoteAccount, bytes) {
            const entry = entries.get(remoteAccount);
            if (!entry || !opts.pairSignaling.isRealtimeReady(entry.pairId)) {
                return { ok: false, reason: "ws_not_ready" };
            }
            if (entry.state !== "usable" || !entry.peer) {
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
            } else if (envelope.t === "spaceMembershipHint") {
                ok = entry.peer.sendSpaceMembershipHint(envelope);
            }
            if (ok) touchEntry(entry);
            if (!ok && entry.state === "usable") {
                recoverStuckPeer(entry, "send_failed");
            }
            return ok ? { ok: true } : { ok: false, reason: "peer_not_ready" };
        },

        getRosterSnapshot(remoteAccount) {
            const entry = entries.get(remoteAccount);
            if (!entry) return null;
            return {
                remote: entry.remote,
                state: entry.state,
                negotiationStartedAt: entry.negotiationStartedAt,
                isJoined: opts.pairSignaling.isJoined(entry.pairId),
                isInitiator: isLexInitiator(opts.localAccount, entry.remote),
                hasPeer: entry.peer != null,
            };
        },

        resendOffer(remoteAccount) {
            entries.get(remoteAccount)?.peer?.resendOffer();
        },

        retriggerHandshake(remoteAccount) {
            const entry = entries.get(remoteAccount);
            if (!entry) return;
            beginNegotiation(entry);
        },

        recoverPeer(remoteAccount, reason) {
            const entry = entries.get(remoteAccount);
            if (!entry) return;
            recoverStuckPeer(entry, reason);
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
                const selfJoinedOnServer = opts.pairSignaling.isJoined(
                    entry.pairId,
                );
                chatDataRecord("peer-registry-remote-signal-buffered", {
                    remote: entry.remote,
                    pairId: entry.pairId,
                    state: entry.state,
                    kind: frame.kind,
                    selfJoinedOnServer,
                    pending: entry.pendingRemoteSignals.length,
                });
                if (selfJoinedOnServer) {
                    beginNegotiation(entry);
                } else {
                    requestNegotiation(entry, "peer_focus");
                }
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

        getKickCounts() {
            return Object.fromEntries(kickCounts);
        },

        resetKickCounts() {
            kickCounts.clear();
        },
    };
}

export type { PeerRegistryEvents };
