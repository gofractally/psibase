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
    graceSeconds: z.number(),
    cycleStartedAt: z.number(),
    cycleGraceSeconds: z.number(),
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

const zForwardOffer = z.object({
    poster: z.string(),
    nextHop: z.string(),
    assetId: z.number(),
    feeFixed: z.string(),
    feePercentPpm: z.number(),
    maxLineAprPpm: z.number(),
    expiresAt: z.number(),
    isGlobal: z.boolean(),
});

const zTakeoutOffer = z.object({
    poster: z.string(),
    debtor: z.string(),
    assetId: z.number(),
    feeFixed: z.string(),
    feePercentPpm: z.number(),
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

const zPayRequest = z.object({
    id: z.number(),
    kind: z.number(),
    poster: z.string(),
    counterparty: z.string(),
    assetId: z.number(),
    amount: z.string(),
    remaining: z.string(),
    memo: z.string(),
    expiresAt: z.number(),
    createdAt: z.number(),
});

export const REQUEST_INVOICE = 1;
export const REQUEST_PLEASE_BOOK = 2;

const zActivity = z.object({
    account: z.string(),
    counterparty: z.string(),
    assetId: z.number(),
    kind: z.string(),
    amount: z.string(),
    netted: z.string(),
    otherAssetId: z.number(),
    actor: z.string(),
    requestId: z.number().optional(),
    memo: z.string().optional(),
    blockTime: z.string().optional(),
});

export type Asset = z.infer<typeof zAsset>;
export type CreditLine = z.infer<typeof zCreditLine>;
export type Obligation = z.infer<typeof zObligation>;
export type ForwardOffer = z.infer<typeof zForwardOffer>;
export type TakeoutOffer = z.infer<typeof zTakeoutOffer>;
export type CurrencyPolicy = z.infer<typeof zCurrencyPolicy>;
export type PayRequest = z.infer<typeof zPayRequest>;
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
            creditor debtor assetId limit depleteOnDebit interestRatePpm
            graceSeconds cycleStartedAt cycleGraceSeconds exposure
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

export async function fetchForwardOffers(
    account: string,
): Promise<ForwardOffer[]> {
    const data = await gql<{ forwardOffers: ForwardOffer[] }>(
        `{ forwardOffers(poster: "${account}") {
            poster nextHop assetId feeFixed feePercentPpm maxLineAprPpm
            expiresAt isGlobal
        } }`,
    );
    return zForwardOffer.array().parse(data.forwardOffers);
}

export async function fetchTakeoutOffers(
    account: string,
): Promise<TakeoutOffer[]> {
    const data = await gql<{ takeoutOffers: TakeoutOffer[] }>(
        `{ takeoutOffers(poster: "${account}") {
            poster debtor assetId feeFixed feePercentPpm expiresAt isGlobal
        } }`,
    );
    return zTakeoutOffer.array().parse(data.takeoutOffers);
}

export async function fetchRequests(account: string): Promise<PayRequest[]> {
    const data = await gql<{ requests: PayRequest[] }>(
        `{ requests(account: "${account}") {
            id kind poster counterparty assetId amount remaining memo
            expiresAt createdAt
        } }`,
    );
    return zPayRequest.array().parse(data.requests);
}

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
                    requestId?: number | string;
                    memo?: string;
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
                    requestId
                    memo
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
                requestId: n.requestId === undefined ? 0 : Number(n.requestId),
                memo: n.memo ?? "",
                blockTime: n.block?.blockTime ?? undefined,
            }),
        );
}
