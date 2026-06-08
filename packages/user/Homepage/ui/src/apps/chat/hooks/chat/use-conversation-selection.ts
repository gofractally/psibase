import { useCallback, useEffect, useRef, useState } from "react";

import { composeTimingLog } from "../../lib/dm-compose-timing";
import { shortSpaceId } from "../../lib/chat-data-debug";
import { recordThreadLifecycle } from "../../lib/thread-lifecycle";
import {
    readLastOpenChatId,
    writeLastOpenChatId,
} from "../../lib/last-open-chat-store";
import type { ConversationSnapshot } from "../../lib/protocol";

export type UseConversationSelectionOptions = {
    chainId: string;
    urlConversationId?: string;
    selfAccount: string | null;
    contactsLoaded: boolean;
    conversations: ConversationSnapshot[];
    /** Number of objective spaces currently loaded. */
    objectiveSpacesCount: number;
    /** Latest spaces-load error (used to bail out of waits). */
    spacesLoadError: string | null;
};

export type UseConversationSelectionResult = {
    selectedConversationId: string | undefined;
    setSelectedConversationId: (
        id: string | undefined,
        source?: string,
    ) => void;
    selectConversation: (id: string, source: string) => void;
    composePendingDmPeer: string | null;
    setComposePendingDmPeer: React.Dispatch<
        React.SetStateAction<string | null>
    >;
    selectedConversationIdRef: React.MutableRefObject<string | undefined>;
    composePendingDmPeerRef: React.MutableRefObject<string | null>;
    pendingDmMemberRef: React.MutableRefObject<string | null>;
};

/**
 * Selected conversation + compose-pending DM peer state.
 *
 * Encapsulates the trio of (selectedConversationId, composePendingDmPeer,
 * pendingDmMemberRef) along with persistence of last-open-chat per chain/self
 * and the restore-on-mount effect. Mutating `pendingDmMemberRef.current`
 * outside the hook is supported so the open-DM flow can mark a transient
 * "expecting space to appear" state without re-rendering.
 */
export function useConversationSelection(
    options: UseConversationSelectionOptions,
): UseConversationSelectionResult {
    const {
        chainId,
        urlConversationId,
        selfAccount,
        contactsLoaded,
        conversations,
        objectiveSpacesCount,
        spacesLoadError,
    } = options;

    const [selectedConversationId, setSelectedConversationIdState] = useState<
        string | undefined
    >();
    const [composePendingDmPeer, setComposePendingDmPeer] = useState<
        string | null
    >(null);

    const urlConversationIdRef = useRef(urlConversationId);
    urlConversationIdRef.current = urlConversationId;
    const lastOpenChatRestoreAttemptedRef = useRef(false);
    const selectedConversationIdRef = useRef<string | undefined>(undefined);
    const composePendingDmPeerRef = useRef<string | null>(null);
    const pendingDmMemberRef = useRef<string | null>(null);

    composePendingDmPeerRef.current = composePendingDmPeer;
    selectedConversationIdRef.current = selectedConversationId;

    const setSelectedConversationId = useCallback(
        (id: string | undefined, source = "unknown") => {
            if (
                source === "url-space" &&
                (composePendingDmPeerRef.current ||
                    pendingDmMemberRef.current)
            ) {
                composeTimingLog("selectConversation-blocked", {
                    source,
                    reason: "compose-pending-dm",
                    pendingPeer:
                        composePendingDmPeerRef.current ??
                        pendingDmMemberRef.current,
                    urlSpace: id ? shortSpaceId(id) : undefined,
                });
                return;
            }
            composeTimingLog("selectConversation", {
                source,
                id: id ? shortSpaceId(id) : undefined,
            });
            const listed = conversations.find((row) => row.conversationId === id);
            recordThreadLifecycle("selected", {
                source,
                spaceId: id ? shortSpaceId(id) : null,
                kind: listed?.kind ?? null,
                memberCount: listed?.members.length ?? null,
            });
            setComposePendingDmPeer(null);
            setSelectedConversationIdState(id);
            if (chainId && selfAccount) {
                writeLastOpenChatId(chainId, selfAccount, id);
            }
        },
        [chainId, selfAccount, conversations],
    );

    useEffect(() => {
        if (!composePendingDmPeer) return;
        recordThreadLifecycle("pending-peer", {
            peer: composePendingDmPeer,
            selectedSpaceId: selectedConversationId
                ? shortSpaceId(selectedConversationId)
                : null,
        });
    }, [composePendingDmPeer, selectedConversationId]);

    const selectConversation = useCallback(
        (id: string, source: string) => {
            if (selectedConversationIdRef.current === id) {
                composeTimingLog("selectConversation noop", {
                    source,
                    id: shortSpaceId(id),
                });
                return;
            }
            const t0 = performance.now();
            composeTimingLog("dm-click", { source, id: shortSpaceId(id), t0 });
            setSelectedConversationId(id, source);
            composeTimingLog("dm-click-setState-done", {
                source,
                dtMs: Math.round(performance.now() - t0),
            });
        },
        [setSelectedConversationId],
    );

    // Clear stale selection when the conversation disappears.
    useEffect(() => {
        if (!selectedConversationId || !contactsLoaded) return;
        if (
            conversations.some(
                (c) => c.conversationId === selectedConversationId,
            )
        ) {
            return;
        }
        if (pendingDmMemberRef.current) return;
        if (selfAccount && !spacesLoadError && objectiveSpacesCount === 0) {
            return;
        }
        composeTimingLog("selection-cleared", {
            selectedConversationId,
            reason: "id-not-in-conversations",
        });
        if (chainId && selfAccount) {
            writeLastOpenChatId(chainId, selfAccount, undefined);
        }
        setSelectedConversationIdState(undefined);
    }, [
        chainId,
        conversations,
        contactsLoaded,
        objectiveSpacesCount,
        selectedConversationId,
        selfAccount,
        spacesLoadError,
    ]);

    // Restore last-open conversation on mount.
    useEffect(() => {
        if (lastOpenChatRestoreAttemptedRef.current) return;
        if (urlConversationIdRef.current) {
            lastOpenChatRestoreAttemptedRef.current = true;
            return;
        }
        if (!contactsLoaded || !selfAccount || !chainId) return;
        if (selectedConversationId || composePendingDmPeer) return;
        if (pendingDmMemberRef.current) return;

        const saved = readLastOpenChatId(chainId, selfAccount);
        if (!saved) {
            lastOpenChatRestoreAttemptedRef.current = true;
            return;
        }

        if (conversations.some((row) => row.conversationId === saved)) {
            setSelectedConversationId(saved, "restore-last-open");
            lastOpenChatRestoreAttemptedRef.current = true;
            return;
        }

        if (selfAccount && !spacesLoadError && objectiveSpacesCount === 0) {
            return;
        }

        lastOpenChatRestoreAttemptedRef.current = true;
    }, [
        chainId,
        contactsLoaded,
        conversations,
        composePendingDmPeer,
        objectiveSpacesCount,
        selectedConversationId,
        selfAccount,
        setSelectedConversationId,
        spacesLoadError,
    ]);

    return {
        selectedConversationId,
        setSelectedConversationId,
        selectConversation,
        composePendingDmPeer,
        setComposePendingDmPeer,
        selectedConversationIdRef,
        composePendingDmPeerRef,
        pendingDmMemberRef,
    };
}
