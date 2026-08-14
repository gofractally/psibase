import { z } from "zod";

import { graphql } from "@shared/lib/graphql";

import { BANX_SERVICE } from "./constants";

const zAsset = z.object({
    id: z.number(),
    symbol: z.string(),
    precision: z.number(),
    description: z.string(),
});

const zCreditLine = z.object({
    creditor: z.string(),
    debtor: z.string(),
    assetId: z.number(),
    limit: z.string(),
    depleteOnDebit: z.boolean(),
    interestRatePpm: z.number(),
    exposure: z.string(),
});

const zObligation = z.object({
    id: z.number(),
    creditor: z.string(),
    debtor: z.string(),
    assetId: z.number(),
    remainingPrincipal: z.string(),
    accruedInterest: z.string(),
    interestRatePpm: z.number(),
    createdAt: z.number(),
    lastInterestAccrual: z.number(),
});

const zClearingOffer = z.object({
    poster: z.string(),
    counterparty: z.string(),
    assetId: z.number(),
    feeFixed: z.string(),
    feePercentPpm: z.number(),
    maxLineAprPpm: z.number(),
    forwardEnabled: z.boolean(),
    expiresAt: z.number(),
    isGlobal: z.boolean(),
});

const zCurrencyPolicy = z.object({
    debtor: z.string(),
    fromAsset: z.number(),
    toAsset: z.number(),
    feeFixed: z.string(),
    fxRate: z.string(),
    toInterestRatePpm: z.number(),
    expiresAt: z.number(),
});

const zActivity = z.object({
    account: z.string(),
    counterparty: z.string(),
    assetId: z.number(),
    kind: z.string(),
    amount: z.string(),
    netted: z.string(),
    otherAssetId: z.number(),
    actor: z.string(),
    blockTime: z.string().optional(),
});

export type Asset = z.infer<typeof zAsset>;
export type CreditLine = z.infer<typeof zCreditLine>;
export type Obligation = z.infer<typeof zObligation>;
export type ClearingOffer = z.infer<typeof zClearingOffer>;
/** @deprecated use ClearingOffer */
export type RoutingPolicy = ClearingOffer;
export type CurrencyPolicy = z.infer<typeof zCurrencyPolicy>;
export type ActivityEvent = z.infer<typeof zActivity>;

const gql = <T>(query: string) =>
    graphql<T>(query, { service: BANX_SERVICE });

export async function fetchAssets(): Promise<Asset[]> {
    const data = await gql<{ assets: Asset[] }>(`{ assets { id symbol precision description } }`);
    return zAsset.array().parse(data.assets).map((a) => ({
        ...a,
        symbol: a.symbol.toUpperCase(),
    }));
}

export async function fetchCreditLines(account: string): Promise<CreditLine[]> {
    const data = await gql<{ creditLines: CreditLine[] }>(
        `{ creditLines(account: "${account}") {
            creditor debtor assetId limit depleteOnDebit interestRatePpm exposure
        } }`,
    );
    return zCreditLine.array().parse(data.creditLines);
}

export async function fetchObligations(account: string): Promise<Obligation[]> {
    const data = await gql<{ obligations: Obligation[] }>(
        `{ obligations(account: "${account}") {
            id creditor debtor assetId remainingPrincipal accruedInterest
            interestRatePpm createdAt lastInterestAccrual
        } }`,
    );
    return zObligation.array().parse(data.obligations);
}

export async function fetchClearingOffers(
    account: string,
): Promise<ClearingOffer[]> {
    const data = await gql<{ clearingOffers: ClearingOffer[] }>(
        `{ clearingOffers(poster: "${account}") {
            poster counterparty assetId feeFixed feePercentPpm maxLineAprPpm
            forwardEnabled expiresAt isGlobal
        } }`,
    );
    return zClearingOffer.array().parse(data.clearingOffers);
}

/** @deprecated use fetchClearingOffers */
export const fetchRoutingPolicies = fetchClearingOffers;

export async function fetchCurrencyPolicies(
    account: string,
): Promise<CurrencyPolicy[]> {
    const data = await gql<{ currencyPolicies: CurrencyPolicy[] }>(
        `{ currencyPolicies(debtor: "${account}") {
            debtor fromAsset toAsset feeFixed fxRate toInterestRatePpm expiresAt
        } }`,
    );
    return zCurrencyPolicy.array().parse(data.currencyPolicies);
}

export async function fetchActivity(
    account: string,
    counterparty: string,
    assetId: number,
): Promise<ActivityEvent[]> {
    const data = await gql<{
        activity: {
            edges: {
                node: {
                    account: string;
                    counterparty: string;
                    assetId: number | string;
                    kind: string;
                    amount: string;
                    netted: string;
                    otherAssetId: number | string;
                    actor: string;
                    block?: { blockTime?: string | null } | null;
                } | null;
            }[];
        };
    }>(
        `{ activity(account: "${account}", counterparty: "${counterparty}", assetId: ${assetId}, last: 50) {
            edges {
                node {
                    account
                    counterparty
                    assetId
                    kind
                    amount
                    netted
                    otherAssetId
                    actor
                    block { blockTime }
                }
            }
        } }`,
    );
    return (data.activity?.edges ?? [])
        .map((e) => e.node)
        .filter((n): n is NonNullable<typeof n> => n != null)
        .map((n) =>
            zActivity.parse({
                account: n.account,
                counterparty: n.counterparty,
                assetId: Number(n.assetId),
                kind: n.kind,
                amount: n.amount,
                netted: n.netted,
                otherAssetId: Number(n.otherAssetId),
                actor: n.actor,
                blockTime: n.block?.blockTime ?? undefined,
            }),
        );
}
