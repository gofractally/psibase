export type Unsubscribe = () => void;

export type MessageStatus = "PENDING" | "DELIVERED" | "FAILED";

export type PeerState =
    | "absent"
    | "waiting_ws"
    | "negotiating"
    | "usable"
    | "suspected_dead"
    | "disposing";

export type EnsureReason =
    | "message_enqueued"
    | "presence_online"
    | "peer_focus"
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
