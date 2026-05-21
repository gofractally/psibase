import {
    parseChatDataWireEnvelope,
    serializeChatDataWireEnvelope,
    type ChatDataMessageAckEnvelope,
    type ChatDataMessageEnvelope,
    type ChatDataWireEnvelope,
    type ChatHistorySyncEnvelope,
} from "./chat-data-envelope";
import {
    chatDataRecord,
    logIceCandidate,
    registerChatDataPeer,
    shortSessionId,
    summarizePeerConnection,
    unregisterChatDataPeer,
} from "./chat-data-debug";
import {
    buildRtcPeerConnectionConfig,
    iceServerSummary,
} from "./ice-config";
import type { IceServerConfig } from "./protocol";
import type { SignalKind, WebRtcSignalingClient } from "./webrtc-signaling-client";
import {
    isLocalDevWebRtcEnvironment,
    normalizeIceCandidateForEnvironment,
} from "./webrtc-local-dev-ice";

const CHAT_DATA_CHANNEL_LABEL = "chat";

export type ChatDataPeerHandlers = {
    onDataChannelOpen?: () => void;
    onChatMessage?: (envelope: ChatDataMessageEnvelope) => void;
    onChatHistorySync?: (envelope: ChatHistorySyncEnvelope) => void;
    /**
     * Plan F7: peer received a delivery ack from the remote end. The
     * orchestrator uses this to mark the pending row as delivered to
     * that recipient (the only authoritative signal — sender-side data
     * channel writes are not reliable on their own).
     */
    onMessageAck?: (envelope: ChatDataMessageAckEnvelope) => void;
    onFailed?: (detail: string) => void;
    /** Peer or datachannel lost but session may resume (peer navigated away, ICE drop, etc.). */
    onTransportLost?: (detail: string) => void;
};

/**
 * DM chat-data peer connection: ordered labeled data channel + SDP/ICE via
 * {@link WebRtcSignalingClient}; message bodies use
 * {@link ChatDataMessageEnvelope}.
 *
 * Negotiation strategy: **Perfect Negotiation** (W3C WebRTC §"perfect
 * negotiation example"). The legacy `isInitiator` flag is now interpreted as
 * "**impolite**": the impolite side wins offer collisions; the polite side
 * rolls back its own offer when it sees a collision and accepts the remote
 * offer instead. Both sides drive offer creation off the
 * `onnegotiationneeded` event, so renegotiation (e.g. `pc.restartIce()`)
 * works symmetrically and a fresh PC after a rejoin doesn't have to know
 * which side will speak first.
 *
 * Why we needed this:
 *   1. Send-after-rejoin wedge. Before, the impolite (initiator) side sent
 *      an offer the moment the PC was created. If the polite side hadn't
 *      yet created its own PC, the offer arrived first and was buffered as
 *      "wrong state". When the polite side later created its PC the
 *      buffered offer was lost and the negotiation never converged.
 *   2. Glare. If both sides happened to push offers simultaneously
 *      (renegotiation, ICE restart) the second `setRemoteDescription` threw
 *      and tore the whole peer down.
 *   3. ICE restart. There was no path to trigger renegotiation without
 *      blowing away the PC and starting from scratch. Phase D will need
 *      this for the conversation outbox's transport-level retry.
 */
export class ChatDataWebRtcPeer {
    readonly sessionId: string;

    private readonly selfAccount: string;

    private readonly peerAccount: string;

    /**
     * F2: who creates the SDP offer first / opens the data channel. Driven
     * by the session roster ("most recent joiner sends the offer"), with
     * lex order as a fallback when no roster is available.
     */
    private readonly isInitiator: boolean;

    /**
     * Perfect Negotiation collision-resolution role. MUST be deterministic
     * and the two ends MUST disagree — this is what makes glare safe. We
     * keep this on the lex rule independent of `isInitiator` so glare
     * resolution stays symmetric even when F2 makes the initiator the late
     * joiner.
     */
    private readonly impolite: boolean;

    private readonly signaling: WebRtcSignalingClient;

    private readonly handlers: ChatDataPeerHandlers;

    private readonly debugPeerId: string;

    private pc: RTCPeerConnection | null = null;

    private dataChannel: RTCDataChannel | null = null;

    private disposed = false;

    private signalingChain: Promise<void> = Promise.resolve();

    private pendingRemoteIce: RTCIceCandidateInit[] = [];

    private localIceSent = 0;

    private remoteIceApplied = 0;

    private transportLostReported = false;

    /**
     * True while `createOffer` → `setLocalDescription` is in flight. Used
     * for collision detection per the Perfect Negotiation algorithm.
     */
    private makingOffer = false;

    /**
     * True from the moment we accept a remote answer until
     * `setRemoteDescription` resolves. Treated as "stable" for collision
     * purposes so we don't mis-detect a collision while applying the answer.
     */
    private isSettingRemoteAnswer = false;

    /**
     * Set when the impolite side decides to drop a colliding remote offer.
     * Cleared once `signalingstatechange` moves us back to a stable phase.
     */
    private ignoreOffer = false;

    constructor(params: {
        sessionId: string;
        selfAccount: string;
        peerAccount: string;
        iceServers: IceServerConfig[] | null;
        signaling: WebRtcSignalingClient;
        /**
         * F2: "this side creates the data channel and sends the first
         * offer". Driven by roster: the most recent joiner is the
         * initiator. Defaults to the lex-lower side when no roster
         * information is available.
         */
        isInitiator: boolean;
        /**
         * Perfect Negotiation collision-resolution role. If omitted,
         * defaults to lex order (lex-lower = impolite). MUST disagree
         * across the two ends. Always pass the same rule on both sides.
         */
        impolite?: boolean;
        handlers?: ChatDataPeerHandlers;
    }) {
        this.sessionId = params.sessionId;
        this.selfAccount = params.selfAccount;
        this.peerAccount = params.peerAccount;
        this.isInitiator = params.isInitiator;
        // Default: lex-lower side is impolite. This matches the legacy
        // behavior when `isInitiator` was driven by lex order.
        this.impolite =
            params.impolite ??
            params.selfAccount.localeCompare(params.peerAccount) < 0;
        this.signaling = params.signaling;
        this.handlers = params.handlers ?? {};
        this.debugPeerId = `${params.sessionId}:${params.selfAccount}:${params.peerAccount}`;

        const pc = new RTCPeerConnection(
            buildRtcPeerConnectionConfig(params.iceServers),
        );
        this.pc = pc;

        registerChatDataPeer(this.debugPeerId, {
            sessionId: this.sessionId,
            selfAccount: this.selfAccount,
            peerAccount: this.peerAccount,
            isInitiator: this.isInitiator,
            getPc: () => this.pc,
        });

        pc.onicecandidate = (ev) => {
            if (this.disposed || !ev.candidate) return;
            const candidateLine = normalizeIceCandidateForEnvironment(
                ev.candidate.candidate,
            );
            if (!candidateLine) return;
            this.localIceSent += 1;
            logIceCandidate("local", candidateLine, {
                sessionId: shortSessionId(this.sessionId),
                n: this.localIceSent,
                rewritten: candidateLine !== ev.candidate.candidate,
            });
            this.signaling.signal({
                sessionId: this.sessionId,
                to: this.peerAccount,
                kind: "candidate",
                candidate: candidateLine,
                sdpMid: ev.candidate.sdpMid ?? undefined,
                sdpMLineIndex: ev.candidate.sdpMLineIndex ?? undefined,
            });
        };

        pc.onicegatheringstatechange = () => {
            if (this.disposed || !this.pc) return;
            chatDataRecord("pc iceGatheringState", {
                sessionId: shortSessionId(this.sessionId),
                self: this.selfAccount,
                state: this.pc.iceGatheringState,
            });
        };

        pc.oniceconnectionstatechange = () => {
            if (this.disposed || !this.pc) return;
            const iceState = this.pc.iceConnectionState;
            chatDataRecord("pc iceConnectionState", {
                sessionId: shortSessionId(this.sessionId),
                self: this.selfAccount,
                state: iceState,
                connectionState: this.pc.connectionState,
            });
            if (iceState === "failed") {
                void this.logFailureSnapshot(`iceConnectionState=${iceState}`);
                this.reportTransportLost(`ICE connection ${iceState}`);
            }
        };

        pc.onsignalingstatechange = () => {
            if (this.disposed || !this.pc) return;
            chatDataRecord("pc signalingState", {
                sessionId: shortSessionId(this.sessionId),
                state: this.pc.signalingState,
            });
            // Clear the "ignoreOffer" latch once we're back to a state
            // where new offers are welcome. Without this, the impolite
            // side could stay deaf to a legitimate later offer because
            // it set ignoreOffer during an earlier collision.
            if (this.pc.signalingState === "stable") {
                this.ignoreOffer = false;
            }
        };

        // Perfect Negotiation: both sides handle `negotiationneeded`.
        // Whoever's `createDataChannel` or `restartIce` triggered it gets
        // to send an offer. Collisions are resolved on the receiving end
        // (see `applyRemoteSignal`).
        pc.onnegotiationneeded = () => {
            void this.driveNegotiation();
        };

        pc.onconnectionstatechange = () => {
            if (this.disposed || !this.pc) return;
            const state = this.pc.connectionState;
            chatDataRecord("pc connectionState", {
                sessionId: shortSessionId(this.sessionId),
                self: this.selfAccount,
                state,
                iceConnectionState: this.pc.iceConnectionState,
                dataChannelState: this.dataChannel?.readyState ?? "none",
            });
            if (state === "connected" && this.dataChannelReady) {
                this.handlers.onDataChannelOpen?.();
            }
            if (state === "failed" || state === "closed") {
                void this.logFailureSnapshot(`connectionState=${state}`);
                this.reportTransportLost(`WebRTC connection ${state}`);
            }
        };

        pc.ondatachannel = (ev) => {
            if (this.disposed) return;
            chatDataRecord("ondatachannel", {
                sessionId: shortSessionId(this.sessionId),
                label: ev.channel.label,
            });
            this.attachDataChannel(ev.channel);
        };

        chatDataRecord("peer created", {
            sessionId: shortSessionId(this.sessionId),
            self: this.selfAccount,
            peer: this.peerAccount,
            isInitiator: params.isInitiator,
            ice: iceServerSummary(params.iceServers),
            localDevIceRewrite: isLocalDevWebRtcEnvironment(),
        });

        // F2: the initiator side opens the data channel. (If both sides
        // opened one we'd negotiate two streams instead of sharing one.)
        // Creating the data channel sets the m-section in the local SDP,
        // which fires `onnegotiationneeded` and starts the handshake.
        //
        // The polite/impolite role for glare resolution is separate (lex
        // order by default) and stays symmetric regardless of who opens
        // the channel — Perfect Negotiation lets either side receive an
        // offer at any time, including via `ondatachannel`.
        if (this.isInitiator) {
            const dc = pc.createDataChannel(CHAT_DATA_CHANNEL_LABEL, {
                ordered: true,
            });
            this.attachDataChannel(dc);
        }
    }

    get dataChannelReady(): boolean {
        return this.dataChannel?.readyState === "open";
    }

    /** Whether this peer sends the initial SDP offer for its mesh leg. */
    get sendsInitialOffer(): boolean {
        return this.isInitiator;
    }

    /**
     * True while an SDP exchange is in flight. Used by the connection
     * reconciler to avoid tearing down a peer when the roster-derived
     * initiator role changes mid-handshake (H19).
     */
    get negotiationInProgress(): boolean {
        if (this.disposed || !this.pc) return false;
        if (this.makingOffer) return true;
        return this.pc.signalingState !== "stable";
    }

    /**
     * True when the PC is in a terminal transport state and the data
     * channel never opened — safe to dispose and recreate (H23).
     */
    get transportUnhealthy(): boolean {
        if (this.disposed || !this.pc) return true;
        if (this.dataChannelReady) return false;
        if (this.negotiationInProgress) return false;
        const cs = this.pc.connectionState;
        const ice = this.pc.iceConnectionState;
        return (
            cs === "failed" ||
            cs === "closed" ||
            cs === "disconnected" ||
            ice === "failed" ||
            ice === "disconnected"
        );
    }

    /** Failed transport or SDP stable with no open data channel (H23). */
    get needsReconnect(): boolean {
        if (this.dataChannelReady) return false;
        if (this.transportUnhealthy) return true;
        return (
            !this.negotiationInProgress &&
            this.pc?.signalingState === "stable"
        );
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    /**
     * Re-broadcast the latest local offer to the peer (initiator side
     * only).
     *
     * Use case: when the peer rejoins, the *server* fans out a new
     * `sessionInvite`. The remote side has thrown away its old PC and is
     * starting fresh. We still have a local-offer ready; retransmitting it
     * lets the remote answer without us having to tear down and re-create
     * the PC on our side (which would invalidate already-gathered ICE
     * candidates and force a fresh DTLS handshake even when it isn't
     * needed).
     *
     * If we're already negotiating (`makingOffer === true` or
     * `signalingState === "have-local-offer"` without a stored description
     * — i.e. createOffer is still resolving), there's nothing to retransmit
     * and the in-flight negotiation will reach the remote naturally.
     */
    private lastResendOfferMs = 0;

    resendOffer(): void {
        if (this.disposed || !this.isInitiator || !this.pc) return;
        const now = Date.now();
        if (now - this.lastResendOfferMs < 2_000) {
            return;
        }
        this.lastResendOfferMs = now;
        if (this.makingOffer) {
            chatDataRecord("resendOffer skipped (offer pending)", {
                sessionId: shortSessionId(this.sessionId),
                signalingState: this.pc.signalingState,
                makingOffer: true,
            });
            return;
        }
        if (
            this.pc.signalingState === "have-local-offer" &&
            this.pc.localDescription?.sdp
        ) {
            chatDataRecord("resendOffer retransmit", {
                sessionId: shortSessionId(this.sessionId),
                to: this.peerAccount,
                sdpBytes: this.pc.localDescription.sdp.length,
            });
            this.signaling.signal({
                sessionId: this.sessionId,
                to: this.peerAccount,
                kind: "offer",
                sdp: this.pc.localDescription.sdp,
            });
            return;
        }
        // No local-offer cached. Kick the negotiation engine and let
        // Perfect Negotiation drive a fresh offer.
        chatDataRecord("resendOffer → restartIce", {
            sessionId: shortSessionId(this.sessionId),
            signalingState: this.pc.signalingState,
        });
        try {
            this.pc.restartIce();
        } catch (e) {
            chatDataRecord("restartIce failed", {
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    /**
     * Trigger renegotiation with an ICE restart. Safe to call at any time
     * (no-op if PC is gone). Used by transport recovery when the data
     * channel goes down but the session is still alive on both ends.
     */
    restartIce(): void {
        if (this.disposed || !this.pc) return;
        try {
            this.pc.restartIce();
        } catch (e) {
            chatDataRecord("restartIce failed", {
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    /** Send a chat envelope when the ordered `chat` data channel is open. */
    sendChatMessage(envelope: ChatDataMessageEnvelope): boolean {
        return this.sendWireEnvelope(envelope);
    }

    sendHistorySync(envelope: ChatHistorySyncEnvelope): boolean {
        return this.sendWireEnvelope(envelope);
    }

    /**
     * Plan F7: confirm receipt of a chatMessage to the sender. Called by
     * the orchestrator immediately after `onChatMessage` has finished
     * persisting the message locally.
     */
    sendMessageAck(envelope: ChatDataMessageAckEnvelope): boolean {
        return this.sendWireEnvelope(envelope);
    }

    private sendWireEnvelope(envelope: ChatDataWireEnvelope): boolean {
        if (this.disposed || !this.dataChannelReady || !this.dataChannel) {
            return false;
        }
        try {
            this.dataChannel.send(serializeChatDataWireEnvelope(envelope));
            return true;
        } catch {
            return false;
        }
    }

    dispose(): void {
        this.disposed = true;
        unregisterChatDataPeer(this.debugPeerId);
        try {
            this.dataChannel?.close();
        } catch {
            /* ignore */
        }
        this.dataChannel = null;
        try {
            this.pc?.close();
        } catch {
            /* ignore */
        }
        this.pc = null;
    }

    async handleRemoteSignal(frame: {
        from?: string;
        kind: SignalKind;
        sdp?: string;
        candidate?: string;
        sdpMid?: string;
        sdpMLineIndex?: number;
    }): Promise<void> {
        const from = frame.from ?? this.peerAccount;
        if (this.disposed || from !== this.peerAccount || !this.pc) return;

        await new Promise<void>((resolve, reject) => {
            this.signalingChain = this.signalingChain
                .then(async () => {
                    await this.applyRemoteSignal(frame);
                    resolve();
                })
                .catch((e) => {
                    reject(e);
                });
        }).catch((e) => {
            const detail =
                e instanceof Error ? e.message : "WebRTC signaling failed";
            chatDataRecord("signaling error", { detail, kind: frame.kind });
            void this.logFailureSnapshot(detail);
            this.handlers.onFailed?.(detail);
        });
    }

    private async logFailureSnapshot(reason: string): Promise<void> {
        const pc = this.pc;
        if (!pc || this.disposed) return;
        const stats = await summarizePeerConnection(pc);
        chatDataRecord("peer failure snapshot", {
            reason,
            sessionId: shortSessionId(this.sessionId),
            self: this.selfAccount,
            peer: this.peerAccount,
            isInitiator: this.isInitiator,
            impolite: this.impolite,
            localIceSent: this.localIceSent,
            remoteIceApplied: this.remoteIceApplied,
            pendingRemoteIce: this.pendingRemoteIce.length,
            ...stats,
        });
    }

    private async flushBufferedRemoteCandidates(): Promise<void> {
        const pc = this.pc;
        if (!pc) return;
        const buf = this.pendingRemoteIce.splice(
            0,
            this.pendingRemoteIce.length,
        );
        if (buf.length > 0) {
            chatDataRecord("flush buffered ICE", {
                count: buf.length,
                sessionId: shortSessionId(this.sessionId),
            });
        }
        for (const init of buf) {
            if (this.disposed) return;
            try {
                await pc.addIceCandidate(new RTCIceCandidate(init));
                this.remoteIceApplied += 1;
            } catch (e) {
                chatDataRecord("addIceCandidate failed (buffered)", {
                    error: e instanceof Error ? e.message : String(e),
                    candidateLine: (init.candidate ?? "").slice(0, 80),
                });
            }
        }
    }

    private async applyRemoteSignal(frame: {
        kind: SignalKind;
        sdp?: string;
        candidate?: string;
        sdpMid?: string;
        sdpMLineIndex?: number;
    }): Promise<void> {
        const pc = this.pc;
        if (!pc || this.disposed) return;

        if (frame.kind === "offer" && frame.sdp) {
            if (
                pc.signalingState === "stable" &&
                pc.remoteDescription?.type === "offer"
            ) {
                chatDataRecord("applyRemote offer dropped (already negotiated)", {
                    sessionId: shortSessionId(this.sessionId),
                    sdpBytes: frame.sdp.length,
                });
                return;
            }
            // Perfect Negotiation collision detection. The classic
            // formulation from the W3C example:
            //   readyForOffer = !makingOffer && (signalingState === "stable" || isSettingRemoteAnswerPending)
            //   offerCollision = !readyForOffer
            //   ignoreOffer = !polite && offerCollision  (impolite = "ignore theirs")
            //   if polite, accept theirs (the implicit rollback in
            //   setRemoteDescription handles our outstanding offer).
            const readyForOffer =
                !this.makingOffer &&
                (pc.signalingState === "stable" ||
                    this.isSettingRemoteAnswer);
            const offerCollision = !readyForOffer;
            const drop = this.impolite && offerCollision;
            chatDataRecord("applyRemote offer", {
                sessionId: shortSessionId(this.sessionId),
                sdpBytes: frame.sdp.length,
                signalingState: pc.signalingState,
                makingOffer: this.makingOffer,
                offerCollision,
                polite: !this.impolite,
                drop,
            });
            if (drop) {
                this.ignoreOffer = true;
                return;
            }
            this.ignoreOffer = false;
            // setRemoteDescription does the implicit rollback for us when
            // the PC is in `have-local-offer` and the remote sends an
            // offer (this is what makes "polite" cheap).
            await pc.setRemoteDescription({
                type: "offer",
                sdp: frame.sdp,
            });
            await this.flushBufferedRemoteCandidates();
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await this.flushBufferedRemoteCandidates();
            if (answer.sdp) {
                chatDataRecord("send answer", {
                    sessionId: shortSessionId(this.sessionId),
                    to: this.peerAccount,
                    sdpBytes: answer.sdp.length,
                });
                this.signaling.signal({
                    sessionId: this.sessionId,
                    to: this.peerAccount,
                    kind: "answer",
                    sdp: answer.sdp,
                });
            }
            return;
        }

        if (frame.kind === "answer" && frame.sdp) {
            // An answer is only meaningful when we're actively waiting for
            // one. Two sources of stale answers:
            //   (a) `resendOffer` race in old code (now fixed by
            //       `makingOffer`).
            //   (b) Server fans out a duplicate signal after a brief
            //       socket reconnect.
            // Either way, dropping is far cheaper than recovering from a
            // setRemoteDescription throw, which used to tear the peer
            // down and loop transport recovery.
            if (pc.signalingState !== "have-local-offer") {
                chatDataRecord("applyRemote answer dropped (wrong state)", {
                    sessionId: shortSessionId(this.sessionId),
                    signalingState: pc.signalingState,
                    sdpBytes: frame.sdp.length,
                });
                return;
            }
            chatDataRecord("applyRemote answer", {
                sessionId: shortSessionId(this.sessionId),
                sdpBytes: frame.sdp.length,
            });
            this.isSettingRemoteAnswer = true;
            try {
                await pc.setRemoteDescription({
                    type: "answer",
                    sdp: frame.sdp,
                });
            } finally {
                this.isSettingRemoteAnswer = false;
            }
            await this.flushBufferedRemoteCandidates();
            return;
        }

        if (frame.kind === "candidate") {
            const candidateLine = normalizeIceCandidateForEnvironment(
                frame.candidate,
            );
            if (!candidateLine) return;
            logIceCandidate("remote", candidateLine, {
                sessionId: shortSessionId(this.sessionId),
                buffered: !pc.remoteDescription,
                rewritten: candidateLine !== (frame.candidate ?? ""),
            });
            const init: RTCIceCandidateInit = {
                candidate: candidateLine,
                sdpMid: frame.sdpMid ?? null,
                sdpMLineIndex: frame.sdpMLineIndex ?? null,
            };
            if (!pc.remoteDescription) {
                this.pendingRemoteIce.push(init);
                chatDataRecord("ICE buffered (no remoteDescription)", {
                    pending: this.pendingRemoteIce.length,
                });
                return;
            }
            try {
                await pc.addIceCandidate(new RTCIceCandidate(init));
                this.remoteIceApplied += 1;
            } catch (e) {
                // Suppress addIceCandidate failures that result from a
                // dropped offer (Perfect Negotiation): if we ignored the
                // offer, the candidates that follow it will fail to
                // attach and that's fine.
                if (!this.ignoreOffer) {
                    chatDataRecord("addIceCandidate failed", {
                        error: e instanceof Error ? e.message : String(e),
                        candidate: frame.candidate?.slice(0, 80),
                    });
                }
            }
            return;
        }

        if (frame.kind === "end-of-candidates") {
            if (pc.remoteDescription) {
                try {
                    await pc.addIceCandidate(null);
                } catch {
                    /* ignore end-of-candidates races */
                }
            }
        }
    }

    private attachDataChannel(dc: RTCDataChannel): void {
        if (this.dataChannel) return;
        this.dataChannel = dc;
        dc.onopen = () => {
            chatDataRecord("data channel open", {
                sessionId: shortSessionId(this.sessionId),
                self: this.selfAccount,
                label: dc.label,
            });
            if (!this.disposed) this.handlers.onDataChannelOpen?.();
        };
        dc.onclose = () => {
            chatDataRecord("data channel close", {
                sessionId: shortSessionId(this.sessionId),
            });
            if (!this.disposed) {
                this.reportTransportLost("data channel closed");
            }
        };
        dc.onerror = () => {
            chatDataRecord("data channel error", {
                sessionId: shortSessionId(this.sessionId),
            });
        };
        dc.onmessage = (ev) => {
            if (this.disposed) return;
            const raw =
                typeof ev.data === "string"
                    ? ev.data
                    : ev.data instanceof ArrayBuffer
                      ? new TextDecoder().decode(ev.data)
                      : null;
            if (raw === null) return;
            const envelope = parseChatDataWireEnvelope(raw);
            if (!envelope) return;
            if (envelope.t === "chatMessage") {
                this.handlers.onChatMessage?.(envelope);
            } else if (envelope.t === "chatHistorySync") {
                this.handlers.onChatHistorySync?.(envelope);
            } else if (envelope.t === "messageAck") {
                this.handlers.onMessageAck?.(envelope);
            }
        };
    }

    private reportTransportLost(detail: string): void {
        if (this.disposed || this.transportLostReported) return;
        this.transportLostReported = true;
        this.handlers.onTransportLost?.(detail);
    }

    /**
     * Perfect Negotiation: invoked from `onnegotiationneeded` (or directly
     * by `restartIce`). Sets `makingOffer` for the duration of
     * `createOffer` + `setLocalDescription`; this is what tells the
     * receiving side that a collision is in flight.
     *
     * We use the explicit createOffer→setLocalDescription pattern instead
     * of the no-arg setLocalDescription() form so the flow is easy to mock
     * in unit tests (real browsers support both; aiortc/Python likewise).
     */
    private async driveNegotiation(): Promise<void> {
        if (this.disposed || !this.pc) return;
        if (this.makingOffer) {
            chatDataRecord("driveNegotiation skipped (already in flight)", {
                sessionId: shortSessionId(this.sessionId),
            });
            return;
        }
        // Don't try to drive a new offer when we're answering one.
        if (
            this.pc.signalingState !== "stable" &&
            this.pc.signalingState !== "have-local-offer"
        ) {
            chatDataRecord("driveNegotiation skipped (wrong state)", {
                sessionId: shortSessionId(this.sessionId),
                signalingState: this.pc.signalingState,
            });
            return;
        }
        this.makingOffer = true;
        chatDataRecord("driveNegotiation", {
            sessionId: shortSessionId(this.sessionId),
            signalingState: this.pc.signalingState,
            polite: !this.impolite,
        });
        try {
            const offer = await this.pc.createOffer();
            if (this.disposed || !this.pc) return;
            await this.pc.setLocalDescription(offer);
            if (offer.sdp) {
                chatDataRecord("send offer", {
                    sessionId: shortSessionId(this.sessionId),
                    to: this.peerAccount,
                    sdpBytes: offer.sdp.length,
                });
                this.signaling.signal({
                    sessionId: this.sessionId,
                    to: this.peerAccount,
                    kind: "offer",
                    sdp: offer.sdp,
                });
            }
        } catch (e) {
            const detail =
                e instanceof Error ? e.message : "Could not create WebRTC offer";
            void this.logFailureSnapshot(detail);
            this.handlers.onFailed?.(detail);
        } finally {
            this.makingOffer = false;
        }
    }
}
