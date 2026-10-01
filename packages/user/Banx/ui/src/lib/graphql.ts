import { z } from "zod";

import { graphql } from "@shared/lib/graphql";

import { BANX_SERVICE } from "./constants";

const zAsset = z.object({
    id: z.number(),
    symbol: z.string(),
    precision: z.number(),
    description: z.string(),
});

const zBookAuth = z.object({
    debtor: z.string(),
    creditor: z.string(),
    assetId: z.number(),
    remaining: z.string(),
    maxInterestRatePpm: z.number(),
    expiresAt: z.number(),
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
    /// When depleting; "0" on revolving lines.
    remaining: z.string(),
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
    allowUnknown: z.boolean(),
});

export const CLAIM_SIDE_BUY = 1;
export const CLAIM_SIDE_SELL = 2;

const zClaimOffer = z.object({
    poster: z.string(),
    debtor: z.string(),
    assetId: z.number(),
    side: z.number(),
    feeFixed: z.string(),
    feePercentPpm: z.number(),
    remaining: z.string(),
    expiresAt: z.number(),
    isGlobal: z.boolean(),
    isBuy: z.boolean(),
    isSell: z.boolean(),
});

const zCashQuote = z.object({
    poster: z.string(),
    assetId: z.number(),
    tokenId: z.number(),
    isOut: z.boolean(),
    feeFixed: z.string(),
    fxRate: z.string(),
    remaining: z.string(),
    expiresAt: z.number(),
});

const zCashVault = z.object({
    poster: z.string(),
    tokenId: z.number(),
    balance: z.string(),
});

const zCurrencyPolicy = z.object({
    poster: z.string(),
    debtor: z.string().optional(),
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

const zBanxInvite = z.object({
    id: z.number(),
    inviter: z.string(),
    assetId: z.number(),
    limit: z.string(),
    depleteOnDebit: z.boolean(),
    interestRatePpm: z.number(),
    graceSeconds: z.number(),
    createdAt: z.number(),
    expiry: z.number(),
    claimedBy: z.string().nullish(),
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
    requestId: z.number().optional(),
    memo: z.string().optional(),
    blockTime: z.string().optional(),
});

export type Asset = z.infer<typeof zAsset>;
export type BookAuth = z.infer<typeof zBookAuth>;
export type CreditLine = z.infer<typeof zCreditLine>;
export type Obligation = z.infer<typeof zObligation>;
export type ForwardOffer = z.infer<typeof zForwardOffer>;
export type ClaimOffer = z.infer<typeof zClaimOffer>;
/** @deprecated use ClaimOffer */
export type BuyClaimOffer = ClaimOffer;
export type CashQuote = z.infer<typeof zCashQuote>;
export type CashVault = z.infer<typeof zCashVault>;
export type CurrencyPolicy = z.infer<typeof zCurrencyPolicy>;
export type PayRequest = z.infer<typeof zPayRequest>;
export type BanxInvite = z.infer<typeof zBanxInvite>;
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

const bookAuthFields = `debtor creditor assetId remaining maxInterestRatePpm expiresAt`;

export async function fetchBookAuths(account: string): Promise<BookAuth[]> {
    const data = await gql<{ bookAuths: BookAuth[] }>(
        `{ bookAuths(account: "${account}") { ${bookAuthFields} } }`,
    );
    return zBookAuth.array().parse(data.bookAuths);
}

export async function fetchCreditLines(account: string): Promise<CreditLine[]> {
    const data = await gql<{ creditLines: CreditLine[] }>(
        `{ creditLines(account: "${account}") {
            creditor debtor assetId limit depleteOnDebit interestRatePpm
            graceSeconds cycleStartedAt cycleGraceSeconds exposure remaining
        } }`,
    );
    return zCreditLine.array().parse(data.creditLines);
}

export async function fetchNetworkLines(): Promise<CreditLine[]> {
    const data = await gql<{ networkLines: CreditLine[] }>(
        `{ networkLines {
            creditor debtor assetId limit depleteOnDebit interestRatePpm
            graceSeconds cycleStartedAt cycleGraceSeconds exposure remaining
        } }`,
    );
    return zCreditLine.array().parse(data.networkLines);
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
            expiresAt isGlobal allowUnknown
        } }`,
    );
    return zForwardOffer.array().parse(data.forwardOffers);
}

export async function fetchClaimOffers(
    account: string,
): Promise<ClaimOffer[]> {
    const data = await gql<{ claimOffers: ClaimOffer[] }>(
        `{ claimOffers(poster: "${account}") {
            poster debtor assetId side feeFixed feePercentPpm remaining expiresAt
            isGlobal isBuy isSell
        } }`,
    );
    return zClaimOffer.array().parse(data.claimOffers);
}

export async function fetchBuyClaimOffers(
    account: string,
): Promise<ClaimOffer[]> {
    const all = await fetchClaimOffers(account);
    return all.filter((o) => o.isBuy);
}

const inviteFields = `id inviter assetId limit depleteOnDebit interestRatePpm graceSeconds createdAt expiry claimedBy`;

export async function fetchInvites(inviter: string): Promise<BanxInvite[]> {
    const data = await gql<{ invites: BanxInvite[] }>(
        `{ invites(inviter: "${inviter}") { ${inviteFields} } }`,
    );
    return zBanxInvite.array().parse(data.invites);
}

export async function fetchInvite(id: number): Promise<BanxInvite | null> {
    const data = await gql<{ invite: BanxInvite | null }>(
        `{ invite(id: ${id}) { ${inviteFields} } }`,
    );
    return data.invite === null || data.invite === undefined
        ? null
        : zBanxInvite.parse(data.invite);
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

const cashQuoteFields = `poster assetId tokenId isOut feeFixed fxRate remaining expiresAt`;

export async function fetchCashQuotes(poster?: string): Promise<CashQuote[]> {
    const arg = poster?.trim() ? `(poster: "${poster.trim()}")` : "";
    const data = await gql<{ cashQuotes: CashQuote[] }>(
        `{ cashQuotes${arg} { ${cashQuoteFields} } }`,
    );
    return zCashQuote.array().parse(data.cashQuotes);
}

export async function fetchCashVault(poster: string): Promise<CashVault[]> {
    const data = await gql<{ cashVault: CashVault[] }>(
        `{ cashVault(poster: "${poster}") { poster tokenId balance } }`,
    );
    return zCashVault.array().parse(data.cashVault);
}

export async function fetchTokenPrecision(tokenId: number): Promise<number> {
    const data = await gql<{ tokenPrecision: number }>(
        `{ tokenPrecision(tokenId: ${tokenId}) }`,
    );
    return z.number().parse(data.tokenPrecision);
}

export async function fetchCurrencyPolicies(
    account: string,
): Promise<CurrencyPolicy[]> {
    const data = await gql<{ currencyPolicies: CurrencyPolicy[] }>(
        `{ currencyPolicies(poster: "${account}") {
            poster fromAsset toAsset feeFixed fxRate toInterestRatePpm expiresAt
        } }`,
    );
    return zCurrencyPolicy.array().parse(data.currencyPolicies);
}

const activityNodeFields = `
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
`;

function parseActivityConnection(data: {
    activity?: {
        edges?: {
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
}): ActivityEvent[] {
    // `last` is Relay chronological (oldest of the page first). Newest on top.
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
        )
        .reverse();
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
            edges { node { ${activityNodeFields} } }
        } }`,
    );
    return parseActivityConnection(data);
}

/** Activity with one counterparty, all assets, newest first. */
export async function fetchActivityWith(
    account: string,
    counterparty: string,
    last = 200,
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
        `{ activity(account: "${account}", counterparty: "${counterparty}", last: ${last}) {
            edges { node { ${activityNodeFields} } }
        } }`,
    );
    return parseActivityConnection(data);
}

/** All activity for `account`, newest first. */
export async function fetchActivityFeed(
    account: string,
    last = 200,
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
        `{ activity(account: "${account}", last: ${last}) {
            edges { node { ${activityNodeFields} } }
        } }`,
    );
    return parseActivityConnection(data);
}
