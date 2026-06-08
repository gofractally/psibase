export type Unsubscribe = () => void;

export type MessageStatus = "PENDING" | "DELIVERED" | "FAILED";

export type PeerState =
    | "absent"
    | "waiting_ws"
    /** L2 joinSession sent; awaiting roster snapshot before PC creation. */
    | "joining_pair"
    | "negotiating"
    | "usable"
    | "suspected_dead"
    | "disposing";

/** Re-drive L2 join when stuck in `joining_pair`. */
export const PEER_JOIN_STUCK_MS = 20_000;
/** Recover PC when stable with no data channel or `needsReconnect`. */
export const PEER_NEGOTIATION_STUCK_MS = 15_000;
export const PEER_STUCK_CHECK_MS = 2_000;

export type EnsureReason =
    | "message_enqueued"
    | "presence_online"
    | "peer_focus"
    | "peer_joined"
    | "roster_kick"
    | "ws_ready"
    | "manual"
    | "meet_start";

export type SendResult =
    | { ok: true }
    | { ok: false; reason: "peer_not_ready" | "ws_not_ready" };

export type SendRequest = {
    spaceUuid: string;
    recipient: string;
    body: unknown;
    clientMsgId?: string;
    autoRetry?: boolean;
};

export type SendGroupRequest = SendRequest & {
    recipients: string[];
};

export type InboundEnvelope = {
    spaceUuid: string;
    from: string;
    body: string;
    sendTimestamp: number;
    clientMsgId: string;
};

export type PendingCount = {
    delivered: number;
    total: number;
};

/** v2 transport constants (locked in chat-data-transport-per-peer.md). */
export const PEER_IDLE_TTL_MS = 5 * 60 * 1000;
export const PEER_MAX_WARM = 10;
export const IN_FLIGHT_ACK_WAIT_MS = 2_500;
export const MAX_VALID_ATTEMPTS = 5;
export const ACK_POLL_INTERVAL_MS = 500;
