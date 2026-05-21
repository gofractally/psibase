/**
 * Standalone RTC pairing primitive for the SessionSim. This file is split
 * out of `chat-data-session-sim.ts` to avoid an import cycle: the
 * `vi.mock("./chat-data-webrtc-peer")` factory used by sim tests imports
 * SimRtcPeer, but the orchestrator (which the sim file imports) also
 * imports `./chat-data-webrtc-peer`. Putting SimRtcPeer here breaks
 * the cycle: the mock factory imports this file (which has no
 * orchestrator deps), and the orchestrator's mocked peer constructor
 * receives a SimRtcPeer instance.
 */
import type {
    ChatDataMessageAckEnvelope,
    ChatDataMessageEnvelope,
    ChatHistorySyncEnvelope,
} from "./chat-data-envelope";

export type SimPeerHandlers = {
    onDataChannelOpen?(): void;
    onChatMessage?(envelope: ChatDataMessageEnvelope): void;
    onChatHistorySync?(envelope: ChatHistorySyncEnvelope): void;
    onMessageAck?(envelope: ChatDataMessageAckEnvelope): void;
    onFailed?(detail: string): void;
    onTransportLost?(detail: string): void;
};

type PairKey = string;

function pairKey(sessionId: string, a: string, b: string): PairKey {
    const accs = [a, b].sort();
    return `${sessionId}::${accs[0]}<>${accs[1]}`;
}

/**
 * Shared registry that pairs SimRtcPeer instances. When both ends of a
 * (sessionId, account-pair) have constructed a peer, both data channels
 * open and inbound messages route across.
 */
export class SimRtcRegistry {
    private peers = new Map<PairKey, SimRtcPeer[]>();

    register(peer: SimRtcPeer): void {
        const key = pairKey(peer.sessionId, peer.selfAccount, peer.peerAccount);
        const bucket = this.peers.get(key) ?? [];
        bucket.push(peer);
        this.peers.set(key, bucket);
        if (bucket.length === 2) {
            const [p0, p1] = bucket;
            p0!.linkMate(p1!);
            p1!.linkMate(p0!);
        }
    }

    unregister(peer: SimRtcPeer): void {
        const key = pairKey(peer.sessionId, peer.selfAccount, peer.peerAccount);
        const bucket = this.peers.get(key);
        if (!bucket) return;
        const idx = bucket.indexOf(peer);
        if (idx >= 0) bucket.splice(idx, 1);
        if (bucket.length === 0) this.peers.delete(key);
    }
}

/**
 * Simulated WebRTC peer. Conforms to the `ChatDataWebRtcPeer` surface
 * the orchestrator/reconciler depend on:
 *   - `sessionId`, `dataChannelReady`, `isDisposed`
 *   - `sendChatMessage`, `sendHistorySync`
 *   - `handleRemoteSignal`, `resendOffer`
 *   - `dispose`
 */
export class SimRtcPeer {
    readonly sessionId: string;

    readonly selfAccount: string;

    readonly peerAccount: string;

    readonly isInitiator: boolean;

    private handlers: SimPeerHandlers;

    private mate: SimRtcPeer | null = null;

    private _dataChannelReady = false;

    private _isDisposed = false;

    constructor(
        private readonly registry: SimRtcRegistry,
        params: {
            sessionId: string;
            selfAccount: string;
            peerAccount: string;
            isInitiator: boolean;
            handlers?: SimPeerHandlers;
        },
    ) {
        this.sessionId = params.sessionId;
        this.selfAccount = params.selfAccount;
        this.peerAccount = params.peerAccount;
        this.isInitiator = params.isInitiator;
        this.handlers = params.handlers ?? {};
        this.registry.register(this);
    }

    get dataChannelReady(): boolean {
        return this._dataChannelReady;
    }

    get isDisposed(): boolean {
        return this._isDisposed;
    }

    /** Called by the registry when our mate is constructed. */
    linkMate(other: SimRtcPeer): void {
        if (this.mate === other) return;
        this.mate = other;
        this._dataChannelReady = true;
        queueMicrotask(() => {
            if (this._isDisposed) return;
            this.handlers.onDataChannelOpen?.();
        });
    }

    sendChatMessage(envelope: ChatDataMessageEnvelope): boolean {
        if (this._isDisposed || !this._dataChannelReady) return false;
        const mate = this.mate;
        if (!mate || mate._isDisposed) return false;
        queueMicrotask(() => {
            if (mate._isDisposed) return;
            mate.handlers.onChatMessage?.(envelope);
        });
        return true;
    }

    sendHistorySync(envelope: ChatHistorySyncEnvelope): boolean {
        if (this._isDisposed || !this._dataChannelReady) return false;
        const mate = this.mate;
        if (!mate || mate._isDisposed) return false;
        queueMicrotask(() => {
            if (mate._isDisposed) return;
            mate.handlers.onChatHistorySync?.(envelope);
        });
        return true;
    }

    sendMessageAck(envelope: ChatDataMessageAckEnvelope): boolean {
        if (this._isDisposed || !this._dataChannelReady) return false;
        const mate = this.mate;
        if (!mate || mate._isDisposed) return false;
        queueMicrotask(() => {
            if (mate._isDisposed) return;
            mate.handlers.onMessageAck?.(envelope);
        });
        return true;
    }

    async handleRemoteSignal(_frame: {
        from?: string;
        kind: string;
        sdp?: string;
        candidate?: string;
        sdpMid?: string;
        sdpMLineIndex?: number;
    }): Promise<void> {
        // SimHub doesn't route signal frames between paired peers — the
        // pair auto-opens. Accept and discard so the orchestrator's
        // signal forwarding doesn't throw.
    }

    resendOffer(): void {
        // No-op for sim — `linkMate` already opened the channel.
    }

    dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this._dataChannelReady = false;
        const mate = this.mate;
        this.mate = null;
        this.registry.unregister(this);
        if (mate && !mate._isDisposed) {
            queueMicrotask(() => {
                mate.handlers.onTransportLost?.(
                    `mate ${this.selfAccount} disposed`,
                );
                mate.mate = null;
                mate._dataChannelReady = false;
            });
        }
    }

    forceFailed(detail = "sim-failed"): void {
        if (this._isDisposed) return;
        this._dataChannelReady = false;
        this.handlers.onFailed?.(detail);
    }
}
