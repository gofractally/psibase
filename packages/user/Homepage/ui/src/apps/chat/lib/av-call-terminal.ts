/** Normalize av-call leave/decline reasons for x-webrtcsig + objective timeline. */
export function normalizeAvCallTerminalReason(reason: string): string {
    const trimmed = reason.trim();
    if (trimmed === "invite-timeout") return "timeout";
    return trimmed;
}

export function isAvCallTerminalReason(reason: string): boolean {
    switch (normalizeAvCallTerminalReason(reason)) {
        case "declined":
        case "timeout":
        case "missed":
        case "cancelled":
            return true;
        default:
            return false;
    }
}

/** Caller-facing copy for declined/missed av-call outcomes (Meet UI). */
export function avCallTerminalUiMessage(reason: string): string {
    switch (normalizeAvCallTerminalReason(reason)) {
        case "declined":
            return "Call declined";
        case "timeout":
        case "missed":
            return "No answer";
        case "cancelled":
            return "Call cancelled";
        default:
            return "Call ended";
    }
}
