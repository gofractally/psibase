import type { TransactionWithContext } from "@/lib/types";

import { useLiveChain } from "@/store/use-live-chain";
import { type Query, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { parseChainTime } from "@/lib/format";
import {
    fetchBillingConfig,
    fetchConsumedHistory,
    fetchPendingTransfers,
    fetchResourcePricing,
    fetchSystemToken,
    fetchTokenTransfers,
    fetchUserResources,
} from "@/lib/user-queries";

const meKey = (user: string | null | undefined, ...rest: unknown[]) =>
    ["me", user ?? "", ...rest] as const;

/**
 * Whether the network has a system token and resource billing configured.
 * Either being absent hides the resources/tokens sections of the dashboard.
 * Both facts are public, so they are read without prompting the user.
 */
export const useResourcesStatus = () => {
    const systemToken = useQuery({
        queryKey: ["me", "network", "system-token"],
        queryFn: fetchSystemToken,
        staleTime: 5 * 60_000,
    });
    const billing = useQuery({
        queryKey: ["me", "network", "billing-config"],
        queryFn: fetchBillingConfig,
        staleTime: 60_000,
    });
    const hasSystemToken = !!systemToken.data;
    const billingInited = !!billing.data;
    return {
        systemToken: systemToken.data ?? null,
        hasSystemToken,
        billingInited,
        billingEnabled: !!billing.data?.enabled,
        feeReceiver: billing.data?.feeReceiver ?? null,
        resourcesAvailable: hasSystemToken && billingInited,
        isPending:
            (systemToken.isPending && !systemToken.isError) ||
            (billing.isPending && !billing.isError),
    };
};

/** Current CPU / network / storage prices. Public; only meaningful once billing is initialized. */
export const useResourcePricing = (enabled = true) =>
    useQuery({
        queryKey: ["me", "network", "pricing"],
        queryFn: fetchResourcePricing,
        enabled,
        refetchInterval: 15_000,
    });

/**
 * The VirtualServer plugin only serves its authorized GraphQL to first-party
 * apps, so from Explorer these calls may be rejected outright. Don't retry or
 * keep polling a query that has been refused; the UI shows a fallback instead.
 */
const pollUnlessRefused =
    (interval: number) =>
    <T>(query: Query<T, Error>) =>
        query.state.status === "error" ? false : interval;

export const useUserResources = (
    user: string | null | undefined,
    enabled = true,
) =>
    useQuery({
        queryKey: meKey(user, "resources"),
        queryFn: () => fetchUserResources(user!),
        enabled: !!user && enabled,
        retry: false,
        refetchInterval: pollUnlessRefused(15_000),
    });

export const useConsumedHistory = (
    user: string | null | undefined,
    enabled = true,
) =>
    useQuery({
        queryKey: meKey(user, "consumed"),
        queryFn: () => fetchConsumedHistory(user!, 200),
        enabled: !!user && enabled,
        retry: false,
        refetchInterval: pollUnlessRefused(20_000),
    });

export const useTokenTransfers = (
    user: string | null | undefined,
    tokenId: string | number | null | undefined,
    enabled = true,
) =>
    useQuery({
        queryKey: meKey(user, "transfers", tokenId ?? ""),
        queryFn: () => fetchTokenTransfers(user!, tokenId!, 25),
        enabled: !!user && tokenId !== null && tokenId !== undefined && enabled,
        refetchInterval: 20_000,
    });

export const usePendingTransfers = (
    user: string | null | undefined,
    enabled = true,
) =>
    useQuery({
        queryKey: meKey(user, "pending"),
        queryFn: () => fetchPendingTransfers(user!),
        enabled: !!user && enabled,
        refetchInterval: 20_000,
    });

// ---------------------------------------------------------------------------
// Activity derived from the live block window
// ---------------------------------------------------------------------------

export interface ActivityPoint {
    /** Bucket start (ms since epoch). */
    time: number;
    /** Actions the user sent in this bucket. */
    sent: number;
    /** Actions targeting a service the user owns (if any). */
    received: number;
}

export interface UserActivity {
    /** Transactions in the window with at least one action sent by the user. */
    sent: TransactionWithContext[];
    /** Transactions in the window that call the user's account as a service. */
    received: TransactionWithContext[];
    actionsSent: number;
    actionsReceived: number;
    /** Services the user called, most-used first. */
    services: { service: string; count: number }[];
    /** Service::method pairs the user called, most-used first. */
    methods: { key: string; service: string; method: string; count: number }[];
    /** Accounts that called into the user's service, most-active first. */
    callers: { sender: string; count: number }[];
    lastSent: TransactionWithContext | null;
    /** Per-block sparkline of actions sent (oldest first). */
    spark: number[];
    /** Time-bucketed series for the activity chart (oldest first). */
    series: ActivityPoint[];
    windowBlocks: number;
    windowSeconds: number;
}

const BUCKETS = 48;

export const useUserActivity = (
    user: string | null | undefined,
): UserActivity => {
    const all = useLiveChain((s) => s.recentTransactions);
    const blocks = useLiveChain((s) => s.blocks);
    const stats = useLiveChain((s) => s.stats);

    return useMemo(() => {
        const empty: UserActivity = {
            sent: [],
            received: [],
            actionsSent: 0,
            actionsReceived: 0,
            services: [],
            methods: [],
            callers: [],
            lastSent: null,
            spark: [],
            series: [],
            windowBlocks: stats.windowBlocks,
            windowSeconds: stats.windowSeconds,
        };
        if (!user) return empty;

        const sent: TransactionWithContext[] = [];
        const received: TransactionWithContext[] = [];
        const serviceMap = new Map<string, number>();
        const methodMap = new Map<string, number>();
        const callerMap = new Map<string, number>();
        let actionsSent = 0;
        let actionsReceived = 0;

        for (const t of all) {
            let isSender = false;
            let isTarget = false;
            for (const a of t.transaction.actions) {
                if (a.sender === user) {
                    isSender = true;
                    actionsSent++;
                    serviceMap.set(
                        a.service,
                        (serviceMap.get(a.service) ?? 0) + 1,
                    );
                    const key = `${a.service}::${a.method}`;
                    methodMap.set(key, (methodMap.get(key) ?? 0) + 1);
                }
                if (a.service === user && a.sender !== user) {
                    isTarget = true;
                    actionsReceived++;
                    if (a.sender)
                        callerMap.set(
                            a.sender,
                            (callerMap.get(a.sender) ?? 0) + 1,
                        );
                }
            }
            if (isSender) sent.push(t);
            if (isTarget) received.push(t);
        }

        // Per-block counts (blocks are oldest -> newest)
        const perBlockSent = new Map<number, number>();
        const perBlockReceived = new Map<number, number>();
        for (const t of sent) {
            const n = t.transaction.actions.filter(
                (a) => a.sender === user,
            ).length;
            perBlockSent.set(
                t.blockNum,
                (perBlockSent.get(t.blockNum) ?? 0) + n,
            );
        }
        for (const t of received) {
            const n = t.transaction.actions.filter(
                (a) => a.service === user && a.sender !== user,
            ).length;
            perBlockReceived.set(
                t.blockNum,
                (perBlockReceived.get(t.blockNum) ?? 0) + n,
            );
        }
        const spark = blocks.map(
            (b) => perBlockSent.get(b.header.blockNum) ?? 0,
        );

        // Time buckets across the window
        let series: ActivityPoint[] = [];
        if (blocks.length > 1) {
            const first = parseChainTime(blocks[0].header.time).getTime();
            const last = parseChainTime(
                blocks[blocks.length - 1].header.time,
            ).getTime();
            const span = Math.max(1, last - first);
            const width = span / BUCKETS;
            series = Array.from({ length: BUCKETS }, (_, i) => ({
                time: first + i * width,
                sent: 0,
                received: 0,
            }));
            for (const b of blocks) {
                const t = parseChainTime(b.header.time).getTime();
                const idx = Math.min(
                    BUCKETS - 1,
                    Math.floor((t - first) / width),
                );
                series[idx].sent += perBlockSent.get(b.header.blockNum) ?? 0;
                series[idx].received +=
                    perBlockReceived.get(b.header.blockNum) ?? 0;
            }
        }

        const sortDesc = <T extends { count: number }>(xs: T[]) =>
            xs.sort((a, b) => b.count - a.count);

        return {
            sent,
            received,
            actionsSent,
            actionsReceived,
            services: sortDesc(
                [...serviceMap.entries()].map(([service, count]) => ({
                    service,
                    count,
                })),
            ),
            methods: sortDesc(
                [...methodMap.entries()].map(([key, count]) => {
                    const [service, method] = key.split("::");
                    return { key, service, method, count };
                }),
            ),
            callers: sortDesc(
                [...callerMap.entries()].map(([sender, count]) => ({
                    sender,
                    count,
                })),
            ),
            lastSent: sent[0] ?? null,
            spark,
            series,
            windowBlocks: stats.windowBlocks,
            windowSeconds: stats.windowSeconds,
        };
    }, [all, blocks, stats.windowBlocks, stats.windowSeconds, user]);
};
