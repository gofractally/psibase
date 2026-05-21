/**
 * Compose-first chat UX (M3 T-018 DM, M4 T-028 group): message input stays enabled
 * while chat-data session and data channels establish in the background.
 */

export type DmComposerDisabledInput = {
    spacesLoadError: string | null;
    authLost: boolean;
    selfAccount: string | null;
    /** Space uuid when known; composer can show before objective row is in sidebar. */
    selectedConversationId: string | undefined;
    /** Opening a DM before ensureDm finishes (Contacts → new thread). */
    pendingDmPeerAccount: string | null;
};

/** Reasons the DM composer must stay disabled (null = enabled). */
export function dmComposerDisabledReason(
    input: DmComposerDisabledInput,
): string | null {
    if (input.spacesLoadError) {
        return `Could not load chat spaces: ${input.spacesLoadError}`;
    }
    if (input.authLost) {
        return "Session expired — refresh the page to sign in again.";
    }
    if (!input.selfAccount) {
        return "Signing in…";
    }
    if (!input.selectedConversationId && !input.pendingDmPeerAccount) {
        return "Select or start a conversation.";
    }
    // Compose-first: typing allowed while ensureDm runs; Send stays enabled once a row exists.
    return null;
}
