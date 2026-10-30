/**
 * Queries backing the signed-in user's dashboard.
 *
 * Everything is read through the explorer plugin, which forwards queries to the
 * VirtualServer and Tokens plugins. Those attach the user's credentials, so
 * data only visible to the account that owns it (balances, transfers, resource
 * buffer, consumption) is included once the user grants Explorer permission.
 */
import { explorer } from "@/lib/plugin";
import { gqlString } from "@/lib/queries";

import { toSystemTokenInfo } from "@shared/hooks/use-system-token";
import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { callPluginFunction } from "@shared/lib/plugins";

// ---------------------------------------------------------------------------
// Network-wide billing facts (public)
// ---------------------------------------------------------------------------

export interface BillingConfig {
    /** ID of the system token used for resource billing. */
    sys: number;
    feeReceiver: string;
    enabled: boolean;
}

/** `null` when resource billing has never been initialized on this network. */
export const fetchBillingConfig = async (): Promise<BillingConfig | null> => {
    const data = await graphqlAuth<{
        getBillingConfig: {
            sys: number;
            feeReceiver: string;
            enabled: boolean;
        } | null;
    }>(
        explorer.virtualServer.graphql,
        `
            {
                getBillingConfig {
                    sys
                    feeReceiver
                    enabled
                }
            }
        `,
    );
    return data.getBillingConfig;
};

export interface SystemTokenInfo {
    id: string;
    /** Token symbol, or `ID: {id}` when the token has no symbol. */
    symbol: string;
    precision: number;
}

/** `null` when the network has no system token configured. */
export const fetchSystemToken = async (): Promise<SystemTokenInfo | null> =>
    toSystemTokenInfo(
        await callPluginFunction(explorer.tokens.getSystemToken, []),
    );

export interface RateLimitPricing {
    /** Smallest billable unit (CPU: ns, NET: bits). */
    billableUnit: number;
    /** Price per billable unit, in system-token base units. */
    pricePerUnit: number;
    availableUnits: number;
    /** Average usage over the pricing window, as a percentage string. */
    avgUsagePct: string;
    thresholds: { idlePct: string; congestedPct: string };
}

export interface ResourcePricing {
    cpu: RateLimitPricing | null;
    net: RateLimitPricing | null;
    disk: {
        remainingCapacity: number;
        maxCapacity: number;
        /** Cost of storing one MiB, decimal string in system-token units. */
        costPerMiB: string;
    } | null;
}

const RATE_FIELDS = `billableUnit pricePerUnit availableUnits avgUsagePct thresholds { idlePct congestedPct }`;

/** Current market prices for CPU, network and storage. Requires billing to be initialized. */
export const fetchResourcePricing = async (): Promise<ResourcePricing> => {
    const data = await graphqlAuth<{
        cpuPricing: RateLimitPricing | null;
        networkPricing: RateLimitPricing | null;
        diskPricing: { remainingCapacity: number; maxCapacity: number } | null;
        diskCost: string;
    }>(
        explorer.virtualServer.graphql,
        `{
            cpuPricing { ${RATE_FIELDS} }
            networkPricing { ${RATE_FIELDS} }
            diskPricing { remainingCapacity maxCapacity }
            diskCost(bytes: 1048576)
        }`,
    );
    return {
        cpu: data.cpuPricing,
        net: data.networkPricing,
        disk: data.diskPricing
            ? { ...data.diskPricing, costPerMiB: String(data.diskCost) }
            : null,
    };
};

// ---------------------------------------------------------------------------
// Resources (VirtualServer, user-authorized)
// ---------------------------------------------------------------------------

export interface UserResources {
    /** Current balance of the resource buffer, in system-token units. */
    balance: number;
    /** Size of the buffer, in system-token units. */
    bufferCapacity: number;
    /** 0 means "never auto-refill". */
    autoFillThresholdPercent: number;
}

export const fetchUserResources = async (
    user: string,
): Promise<UserResources | null> => {
    const data = await graphqlAuth<{
        userResources: {
            balance: string | number;
            bufferCapacity: string | number;
            autoFillThresholdPercent: string | number;
        } | null;
    }>(
        explorer.virtualServer.graphql,
        `{ userResources(account: ${gqlString(user)}) {
            balance bufferCapacity autoFillThresholdPercent
        } }`,
    );
    if (!data.userResources) return null;
    return {
        balance: Number(data.userResources.balance),
        bufferCapacity: Number(data.userResources.bufferCapacity),
        autoFillThresholdPercent: Number(
            data.userResources.autoFillThresholdPercent,
        ),
    };
};

export type ResourceKind = "CPU" | "NET" | "DISK";

export interface ConsumptionEvent {
    blockNum: number | null;
    blockTime: string | null;
    resource: ResourceKind;
    /** CPU in ms, NET/DISK in bytes. Negative DISK means storage was freed. */
    amount: number;
    unit: string;
    /** Signed decimal string in system-token units (negative = refund). */
    cost: string;
}

const normalizeResource = (value: string): ResourceKind => {
    const upper = value.toUpperCase();
    if (upper.startsWith("CPU")) return "CPU";
    if (upper.startsWith("NET")) return "NET";
    return "DISK";
};

interface BlockContext {
    blockNum: number | null;
    blockTime: string | null;
}

export const fetchConsumedHistory = async (
    user: string,
    last = 200,
): Promise<ConsumptionEvent[]> => {
    const data = await graphqlAuth<{
        consumedHistory: {
            edges: {
                node: {
                    block: BlockContext | null;
                    resource: string;
                    amount: string | number;
                    unit: string;
                    cost: string;
                };
            }[];
        };
    }>(
        explorer.virtualServer.graphql,
        `{ consumedHistory(account: ${gqlString(user)}, last: ${last}) {
            edges { node {
                block { blockNum blockTime }
                resource amount unit cost
            } }
        } }`,
    );
    return data.consumedHistory.edges
        .map(({ node }) => ({
            blockNum: node.block?.blockNum ?? null,
            blockTime: node.block?.blockTime ?? null,
            resource: normalizeResource(node.resource),
            amount: Number(node.amount),
            unit: node.unit,
            cost: node.cost,
        }))
        .reverse(); // newest first
};

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export type TransferAction = "credited" | "debited" | "uncredited" | "rejected";

export interface TokenTransfer {
    blockNum: number | null;
    blockTime: string | null;
    tokenId: number;
    account: string;
    counterParty: string;
    action: TransferAction;
    /** Decimal string in token units. */
    amount: string;
    memo: string;
}

export const fetchTokenTransfers = async (
    user: string,
    tokenId: number | string,
    last = 25,
): Promise<TokenTransfer[]> => {
    const data = await graphqlAuth<{
        balChanges: {
            edges: {
                node: {
                    block: BlockContext | null;
                    tokenId: number;
                    account: string;
                    counterParty: string;
                    action: string;
                    amount: string;
                    memo: string;
                };
            }[];
        };
    }>(
        explorer.tokens.graphql,
        `{ balChanges(tokenId: ${Number(tokenId)}, account: ${gqlString(user)}, last: ${last}) {
            edges { node {
                block { blockNum blockTime }
                tokenId account counterParty action amount memo
            } }
        } }`,
    );
    return data.balChanges.edges
        .map(({ node }) => ({
            blockNum: node.block?.blockNum ?? null,
            blockTime: node.block?.blockTime ?? null,
            tokenId: node.tokenId,
            account: node.account,
            counterParty: node.counterParty,
            action: node.action as TransferAction,
            amount: node.amount,
            memo: node.memo,
        }))
        .reverse(); // newest first
};

export interface PendingTransfer {
    tokenId: number;
    symbol: string | null;
    precision: number;
    balance: string;
    creditor: string;
    debitor: string;
}

/** Open lines of credit where the user is either creditor or debitor. */
export const fetchPendingTransfers = async (
    user: string,
): Promise<PendingTransfer[]> => {
    const data = await graphqlAuth<{
        userPending: {
            nodes: {
                sharedBal: {
                    token: {
                        id: number;
                        symbol: string | null;
                        precision: number;
                    };
                    balance: string;
                    creditor: string;
                    debitor: string;
                };
            }[];
        };
    }>(
        explorer.tokens.graphql,
        `{ userPending(user: ${gqlString(user)}, first: 50) {
            nodes { sharedBal {
                token { id symbol precision }
                balance creditor debitor
            } }
        } }`,
    );
    return data.userPending.nodes.map(({ sharedBal }) => ({
        tokenId: sharedBal.token.id,
        symbol: sharedBal.token.symbol,
        precision: sharedBal.token.precision,
        balance: sharedBal.balance,
        creditor: sharedBal.creditor,
        debitor: sharedBal.debitor,
    }));
};
