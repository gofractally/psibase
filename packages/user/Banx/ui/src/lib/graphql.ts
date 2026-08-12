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

const zRoutingPolicy = z.object({
    creditor: z.string(),
    debtor: z.string(),
    inAsset: z.number(),
    outAsset: z.number(),
    hopFeeFixed: z.string(),
    maxAcceptRatePpm: z.number(),
    fxRate: z.string(),
    expiresAt: z.number(),
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

export type Asset = z.infer<typeof zAsset>;
export type CreditLine = z.infer<typeof zCreditLine>;
export type Obligation = z.infer<typeof zObligation>;
export type RoutingPolicy = z.infer<typeof zRoutingPolicy>;
export type CurrencyPolicy = z.infer<typeof zCurrencyPolicy>;

const gql = <T>(query: string) =>
    graphql<T>(query, { service: BANX_SERVICE });

export async function fetchAssets(): Promise<Asset[]> {
    const data = await gql<{ assets: Asset[] }>(`{ assets { id symbol precision description } }`);
    return zAsset.array().parse(data.assets);
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

export async function fetchRoutingPolicies(
    account: string,
): Promise<RoutingPolicy[]> {
    const data = await gql<{ routingPolicies: RoutingPolicy[] }>(
        `{ routingPolicies(debtor: "${account}") {
            creditor debtor inAsset outAsset hopFeeFixed maxAcceptRatePpm fxRate expiresAt
        } }`,
    );
    return zRoutingPolicy.array().parse(data.routingPolicies);
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
