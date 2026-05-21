import type { AvCallSessionSnapshot } from "./av-call-session-types";

export type ChatDataIdleReleaseInput = {
    spaceId: string;
    selectedConversationId: string | null | undefined;
    stillPendingForSpace: boolean;
    avCallSnapshot?: AvCallSessionSnapshot | null;
    activeAvCallConversationId?: string | null;
    activeAvCallSource?: string | null;
};

/** True when an av-call session is establishing or connected on this Space. */
export function isAvCallTransportActive(
    snap: AvCallSessionSnapshot | null | undefined,
): boolean {
    if (!snap) return false;
    return snap.phase !== "idle" && snap.phase !== "failed";
}

/**
 * DM chat-data transport may be torn down after pending delivery completes when the
 * Space is not selected. Retain transport while Meet is active so M3 chat keeps working
 * on the final M5 stack (T-047).
 */
export type BackgroundDmEnsureThrottleInput = {
    selectedConversationId: string | undefined;
    ensureSpaceUuid: string;
    conversations: ReadonlyArray<{
        conversationId: string;
        kind: "dm" | "group";
    }>;
    lastEnsureMs: number;
    now?: number;
    throttleMs?: number;
};

/**
 * While a group thread is focused, throttle pending-flush `ensureDm` for other
 * spaces so ICE/signaling for background DMs does not wedge the main thread
 * during navigation churn (H28).
 */
export function shouldThrottleBackgroundDmEnsure(
    input: BackgroundDmEnsureThrottleInput,
): boolean {
    const selected = input.selectedConversationId;
    if (!selected || selected === input.ensureSpaceUuid) return false;
    const focused = input.conversations.find(
        (row) => row.conversationId === selected,
    );
    if (focused?.kind !== "group") return false;
    const throttleMs = input.throttleMs ?? 3_000;
    const now = input.now ?? Date.now();
    return now - input.lastEnsureMs < throttleMs;
}

export function shouldReleaseIdleChatDataTransport(
    input: ChatDataIdleReleaseInput,
): boolean {
    if (input.stillPendingForSpace) return false;
    if (input.selectedConversationId === input.spaceId) return false;

    if (
        input.activeAvCallConversationId === input.spaceId &&
        input.activeAvCallSource === "av-call"
    ) {
        return false;
    }

    const snap = input.avCallSnapshot;
    if (
        snap &&
        snap.spaceUuid === input.spaceId &&
        isAvCallTransportActive(snap)
    ) {
        return false;
    }

    return true;
}
