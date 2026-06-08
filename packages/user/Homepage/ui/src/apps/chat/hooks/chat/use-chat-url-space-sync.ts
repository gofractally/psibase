import { useEffect, useRef } from "react";
import type { SetURLSearchParams } from "react-router-dom";

import { composeTimingLog } from "../../lib/dm-compose-timing";
import { shortSpaceId } from "../../lib/chat-data-debug";

export type UseChatUrlSpaceSyncOptions = {
    spaceFromUrl: string | undefined;
    selectedConversationId: string | undefined;
    composePendingDmPeer: string | null;
    setSelectedConversationId: (
        id: string | undefined,
        source?: string,
    ) => void;
    searchParams: URLSearchParams;
    setSearchParams: SetURLSearchParams;
};

/** Whether inbound `?space=` should drive selection (not during compose-first DM). */
export function shouldApplySpaceFromUrl(
    spaceFromUrl: string | undefined,
    composePendingDmPeer: string | null,
    pendingDmMember?: string | null,
): boolean {
    if (!spaceFromUrl) return false;
    if (composePendingDmPeer || pendingDmMember) return false;
    return true;
}

/** Whether UI selection should be written back to `?space=`. */
export function shouldPushSelectionToUrl(
    selectedConversationId: string | undefined,
    composePendingDmPeer: string | null,
    currentSpaceParam: string | null,
): boolean {
    if (!selectedConversationId || composePendingDmPeer) return false;
    return currentSpaceParam !== selectedConversationId;
}

/**
 * Keeps `?space=` and selected conversation in sync without clobbering an
 * in-flight compose-first DM (pending peer + stale group URL).
 */
export function useChatUrlSpaceSync(
    options: UseChatUrlSpaceSyncOptions,
): void {
    const {
        spaceFromUrl,
        selectedConversationId,
        composePendingDmPeer,
        setSelectedConversationId,
        searchParams,
        setSearchParams,
    } = options;

    const pendingPeerRef = useRef(composePendingDmPeer);
    pendingPeerRef.current = composePendingDmPeer;

    const setSelectedRef = useRef(setSelectedConversationId);
    setSelectedRef.current = setSelectedConversationId;

    /** Last `?space=` value applied to selection — avoids re-applying stale URL when the setter identity changes (e.g. after conversations refresh). */
    const lastAppliedSpaceFromUrlRef = useRef<string | undefined>(undefined);

    // Inbound: apply deep-link / browser navigation when `?space=` changes only.
    // Depends on spaceFromUrl alone so conversations refresh cannot re-trigger
    // apply of a stale group URL after openOrFocusDm selects a DM space.
    useEffect(() => {
        if (!spaceFromUrl) {
            lastAppliedSpaceFromUrlRef.current = undefined;
            return;
        }
        if (!shouldApplySpaceFromUrl(spaceFromUrl, pendingPeerRef.current)) {
            return;
        }
        if (lastAppliedSpaceFromUrlRef.current === spaceFromUrl) {
            return;
        }
        lastAppliedSpaceFromUrlRef.current = spaceFromUrl;
        setSelectedRef.current(spaceFromUrl, "url-space");
    }, [spaceFromUrl]);

    useEffect(() => {
        if (
            !shouldPushSelectionToUrl(
                selectedConversationId,
                composePendingDmPeer,
                searchParams.get("space"),
            )
        ) {
            return;
        }
        composeTimingLog("url-space-push", {
            from: searchParams.get("space")
                ? shortSpaceId(searchParams.get("space")!)
                : null,
            to: shortSpaceId(selectedConversationId!),
        });
        lastAppliedSpaceFromUrlRef.current = selectedConversationId!;
        const next = new URLSearchParams(searchParams);
        next.set("space", selectedConversationId!);
        setSearchParams(next, { replace: true });
    }, [
        selectedConversationId,
        composePendingDmPeer,
        searchParams,
        setSearchParams,
    ]);
}
