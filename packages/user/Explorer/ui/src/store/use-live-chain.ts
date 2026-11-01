import { useEffect, useState, useSyncExternalStore } from "react";

import { type LiveChainState, liveChain } from "./live-chain";

export const useLiveChain = <T = LiveChainState>(
    selector: (state: LiveChainState) => T = (s) => s as unknown as T,
): T =>
    useSyncExternalStore(
        liveChain.subscribe,
        () => selector(liveChain.getState()),
        () => selector(liveChain.getState()),
    );

export const useHead = () => useLiveChain((s) => s.head);
export const useLiveStatus = () => useLiveChain((s) => s.status);
export const useChainStats = () => useLiveChain((s) => s.stats);
export const useRecentBlocks = () => useLiveChain((s) => s.blocks);
export const useRecentTransactions = (includeSystem: boolean) =>
    useLiveChain((s) =>
        includeSystem ? s.recentTransactions : s.recentUserTransactions,
    );

/** A ticking clock (1s) so relative timestamps stay fresh. */
export const useNow = (intervalMs = 1000) => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
};
