import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { FAVOR_SERVICE } from "@/lib/constants";
import { favorAuthorized } from "@/lib/graphql";
import { QueryKey } from "@/lib/query-keys";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

/** Balances and lines. Skips activity queries so a feed poll cannot refetch itself. */
export function useInvalidateLedger() {
    const qc = useQueryClient();
    const { data: user } = useCurrentUser();
    return useCallback(() => {
        void qc.invalidateQueries({ queryKey: QueryKey.assets() });
        if (!user) return;
        void qc.invalidateQueries({ queryKey: QueryKey.creditLines(user) });
        void qc.invalidateQueries({ queryKey: QueryKey.bookAuths(user) });
        void qc.invalidateQueries({ queryKey: QueryKey.obligations(user) });
        void qc.invalidateQueries({
            queryKey: QueryKey.forwardOffers(user),
        });
        void qc.invalidateQueries({
            queryKey: QueryKey.claimOffers(user),
        });
        void qc.invalidateQueries({
            queryKey: ["favor", "fxOffers"],
        });
        void qc.invalidateQueries({
            queryKey: QueryKey.requests(user),
        });
        void qc.invalidateQueries({
            queryKey: QueryKey.payAuths(user),
        });
        void qc.invalidateQueries({ queryKey: QueryKey.invites(user) });
        void qc.invalidateQueries({ queryKey: ["favor", "cashQuotes"] });
        void qc.invalidateQueries({ queryKey: ["favor", "favorRelays"] });
        void qc.invalidateQueries({ queryKey: ["favor", "tokenRelays"] });
        void qc.invalidateQueries({
            queryKey: QueryKey.cashVault(user),
        });
    }, [qc, user]);
}

function useInvalidateFavor() {
    const qc = useQueryClient();
    const { data: user } = useCurrentUser();
    const invalidateLedger = useInvalidateLedger();
    return () => {
        invalidateLedger();
        if (!user) return;
        void qc.invalidateQueries({
            queryKey: QueryKey.activityFeed(user),
        });
        void qc.invalidateQueries({ queryKey: ["favor", "activityWith"] });
        void qc.invalidateQueries({ queryKey: ["favor", "activity"] });
    };
}

async function favorCall(method: string, params: unknown[]) {
    await supervisor.functionCall({
        service: FAVOR_SERVICE,
        intf: "api",
        method,
        params,
    });
}

export function useSetCreditLine() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            debtor: string;
            assetId: number;
            /** Human decimal, e.g. `"100.00"` */
            limit: string;
            depleteOnDebit: boolean;
        }) =>
            favorCall("setCreditLine", [
                p.debtor,
                p.assetId,
                p.limit,
                p.depleteOnDebit,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Credit line saved");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRemoveCreditLine() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: { debtor: string; assetId: number }) =>
            favorCall("removeCreditLine", [p.debtor, p.assetId]),
        onSuccess: () => {
            invalidate();
            toast.success("Credit line removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSetBookAuth() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            creditor: string;
            assetId: number;
            remaining: string;
            expiresAtSeconds: number;
        }) =>
            favorCall("setBookAuth", [
                p.creditor,
                p.assetId,
                p.remaining,
                p.expiresAtSeconds,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Book-auth saved");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRemoveBookAuth() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: { creditor: string; assetId: number }) =>
            favorCall("removeBookAuth", [p.creditor, p.assetId]),
        onSuccess: () => {
            invalidate();
            toast.success("Book-auth removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useBook() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            debtor: string;
            assetId: number;
            amount: string;
            memo: string;
        }) =>
            favorCall("book", [
                p.debtor,
                p.assetId,
                p.amount,
                p.memo,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Expense booked");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useDeposit() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            depositor: string;
            assetId: number;
            amount: string;
            requestId?: number;
        }) =>
            favorCall("deposit", [
                p.depositor,
                p.assetId,
                p.amount,
                p.requestId ?? 0,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Deposit booked");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useCreateRequest() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            kind: number;
            counterparty: string;
            assetId: number;
            amount: string;
            memo: string;
            expiresAtSeconds: number;
        }) =>
            favorCall("createRequest", [
                p.kind,
                p.counterparty,
                p.assetId,
                p.amount,
                p.memo,
                p.expiresAtSeconds,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Request posted");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useCancelRequest() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (id: number) => favorCall("cancelRequest", [id]),
        onSuccess: () => {
            invalidate();
            toast.success("Request cancelled");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useForgive() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            debtor: string;
            assetId: number;
            amount: string;
        }) => favorCall("forgive", [p.debtor, p.assetId, p.amount]),
        onSuccess: () => {
            invalidate();
            toast.success("Claim written off");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function usePathPay() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            route: string;
            /** Raw units from the quote. */
            amount: string;
            minReturn: string;
            requestId?: number;
        }) =>
            favorCall("pathPay", [
                p.route,
                p.amount,
                p.minReturn,
                p.requestId ?? 0,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Transfer succeeded");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSetPayAuth() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            payee: string;
            assetId: number;
            amount: string;
            maxSpend: string;
            periodSeconds: number;
            nextDueSeconds: number;
            endsAtSeconds: number;
        }) =>
            favorCall("setPayAuth", [
                p.payee,
                p.assetId,
                p.amount,
                p.maxSpend,
                p.periodSeconds,
                p.nextDueSeconds,
                p.endsAtSeconds,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Repeating payment saved");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRunPayAuth() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: { id: number; route: string }) =>
            favorCall("runPayAuth", [p.id, p.route]),
        onSuccess: () => {
            invalidate();
            toast.success("Repeating payment collected");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useCancelPayAuth() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: { id: number; forceCancel: boolean }) =>
            favorCall("cancelPayAuth", [p.id, p.forceCancel]),
        onSuccess: () => {
            invalidate();
            toast.success("Repeating payment deleted");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function usePayInvoice() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            route: string;
            /** Raw units, the most the payer will be drawn. */
            maxSpend: string;
            requestId: number;
        }) =>
            favorCall("payInv", [p.route, p.maxSpend, p.requestId]),
        onSuccess: () => {
            invalidate();
            toast.success("Invoice paid");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export type PathQuote = {
    /** Sealed blob. Submit this; do not build a hop list. */
    route: string;
    /** Raw units. */
    amountIn: string;
    amountOut: string;
    expiresAt: number;
    hopCount: number;
    /** Suggested path_pay min-return (last-hop asset). */
    minReturn: string;
};

/** Curve output or required input. The plugin calls the service math. */
export function useCurveQuote(
    reserveIn: bigint,
    reserveOut: bigint,
    amount: bigint,
    feePpm: number,
    exactOut: boolean,
) {
    const enabled =
        reserveIn > 0n &&
        reserveOut > 0n &&
        amount > 0n &&
        feePpm >= 0 &&
        feePpm < 1_000_000;
    return useQuery({
        queryKey: [
            "favor",
            "curveQuote",
            exactOut ? "in" : "out",
            reserveIn.toString(),
            reserveOut.toString(),
            amount.toString(),
            feePpm,
        ],
        enabled,
        staleTime: Infinity,
        queryFn: async (): Promise<bigint | null> => {
            const res = await supervisor.functionCall({
                service: FAVOR_SERVICE,
                intf: "helpers",
                method: exactOut ? "quoteCurveIn" : "quoteCurveOut",
                params: [
                    reserveIn.toString(),
                    reserveOut.toString(),
                    amount.toString(),
                    feePpm,
                ],
            });
            if (res == null || res === "") return null;
            return BigInt(String(res));
        },
    });
}

/** Sealed path quote. Hops stay on the query service. */
export function useQuotePath() {
    return useMutation({
        mutationFn: async (p: {
            fromAccount: string;
            toAccount: string;
            /** Human decimal. */
            amount: string;
            fromAsset: number;
            /** Final hop must be in this asset. */
            toAsset: number;
            maxHops: number;
            /**
             * false: `amount` is what you send (fees reduce receive).
             * true: `amount` is what payee receives (you absorb hop/FX fees).
             */
            exactOut?: boolean;
        }): Promise<PathQuote> => {
            const exactOut = p.exactOut === true;
            // JSON.stringify gives a valid GraphQL string literal, so free
            // text such as a typed payee cannot break out of the query.
            const data = await graphqlAuth<{
                quotePath: {
                    route: string;
                    amountIn: string;
                    amountOut: string;
                    minReturn: string;
                    expiresAt: number;
                    hopCount: number;
                };
            }>(
                favorAuthorized.authorized.graphql,
                `{ quotePath(from: ${JSON.stringify(p.fromAccount)}, to: ${JSON.stringify(p.toAccount)}, amount: ${JSON.stringify(p.amount)}, fromAsset: ${p.fromAsset}, toAsset: ${p.toAsset}, maxHops: ${p.maxHops}, exactOut: ${exactOut}) {
                    route amountIn amountOut minReturn expiresAt hopCount
                } }`,
            );
            const q = data.quotePath;
            return {
                route: q.route,
                amountIn: q.amountIn,
                amountOut: q.amountOut,
                minReturn: q.minReturn,
                expiresAt: q.expiresAt,
                hopCount: q.hopCount,
            };
        },
    });
}

export function useSetForwardOffer() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            nextHop: string;
            assetId: number;
            feeFixed: string;
            feePercentPpm: number;
            expiresAtSeconds: number;
            allowUnknown: boolean;
        }) => {
            await favorCall("setForwardOffer", [
                p.nextHop,
                p.assetId,
                p.feeFixed,
                p.feePercentPpm,
                p.expiresAtSeconds,
                p.allowUnknown,
            ]);
        },
        onSuccess: () => {
            invalidate();
            toast.success("Path-forward offer saved");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSetGlobalForwardOffer() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            assetId: number;
            feeFixed: string;
            feePercentPpm: number;
            expiresAtSeconds: number;
            allowUnknown: boolean;
        }) => {
            await favorCall("setGlobalForwardOffer", [
                p.assetId,
                p.feeFixed,
                p.feePercentPpm,
                p.expiresAtSeconds,
                p.allowUnknown,
            ]);
        },
        onSuccess: () => {
            invalidate();
            toast.success("Global path-forward offer saved");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRemoveForwardOffer() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: { nextHop: string; assetId: number }) =>
            favorCall("removeForwardOffer", [p.nextHop, p.assetId]),
        onSuccess: () => {
            invalidate();
            toast.success("Path-forward offer removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRemoveGlobalForwardOffer() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: { assetId: number }) =>
            favorCall("removeGlobalForwardOffer", [p.assetId]),
        onSuccess: () => {
            invalidate();
            toast.success("Global path-forward offer removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSetBuyClaimOffer() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            debtor: string;
            assetId: number;
            feeFixed: string;
            feePercentPpm: number;
            remaining: string;
            expiresAtSeconds: number;
        }) =>
            favorCall("setBuyClaimOffer", [
                p.debtor,
                p.assetId,
                p.feeFixed,
                p.feePercentPpm,
                p.remaining,
                p.expiresAtSeconds,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Buy-claim offer saved");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSetGlobalBuyClaimOffer() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            assetId: number;
            feeFixed: string;
            feePercentPpm: number;
            remaining: string;
            expiresAtSeconds: number;
        }) =>
            favorCall("setGlobalBuyClaimOffer", [
                p.assetId,
                p.feeFixed,
                p.feePercentPpm,
                p.remaining,
                p.expiresAtSeconds,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Global buy-claim offer saved");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRemoveBuyClaimOffer() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: { debtor: string; assetId: number }) =>
            favorCall("removeBuyClaimOffer", [p.debtor, p.assetId]),
        onSuccess: () => {
            invalidate();
            toast.success("Buy-claim offer removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRemoveGlobalBuyClaimOffer() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: { assetId: number }) =>
            favorCall("removeGlobalBuyClaimOffer", [p.assetId]),
        onSuccess: () => {
            invalidate();
            toast.success("Global buy-claim offer removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSetSellClaimOffer() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            debtor: string;
            assetId: number;
            feeFixed: string;
            feePercentPpm: number;
            remaining: string;
            expiresAtSeconds: number;
        }) =>
            favorCall("setSellClaimOffer", [
                p.debtor,
                p.assetId,
                p.feeFixed,
                p.feePercentPpm,
                p.remaining,
                p.expiresAtSeconds,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Sell-claim offer saved");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSetGlobalSellClaimOffer() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            assetId: number;
            feeFixed: string;
            feePercentPpm: number;
            remaining: string;
            expiresAtSeconds: number;
        }) =>
            favorCall("setGlobalSellClaimOffer", [
                p.assetId,
                p.feeFixed,
                p.feePercentPpm,
                p.remaining,
                p.expiresAtSeconds,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Global sell-claim offer saved");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRemoveSellClaimOffer() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: { debtor: string; assetId: number }) =>
            favorCall("removeSellClaimOffer", [p.debtor, p.assetId]),
        onSuccess: () => {
            invalidate();
            toast.success("Sell-claim offer removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRemoveGlobalSellClaimOffer() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: { assetId: number }) =>
            favorCall("removeGlobalSellClaimOffer", [p.assetId]),
        onSuccess: () => {
            invalidate();
            toast.success("Global sell-claim offer removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSellClaim() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            buyer: string;
            debtor: string;
            assetId: number;
            amount: string;
            minProceeds: string;
        }) =>
            favorCall("sellClaim", [
                p.buyer,
                p.debtor,
                p.assetId,
                p.amount,
                p.minProceeds,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Claim sold");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useBuyClaim() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            seller: string;
            debtor: string;
            assetId: number;
            amount: string;
            maxCost: string;
        }) =>
            favorCall("buyClaim", [
                p.seller,
                p.debtor,
                p.assetId,
                p.amount,
                p.maxCost,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Claim bought");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSetFxOffer() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            fromAsset: number;
            toAsset: number;
            /** True when they owe you the from-asset. False when you owe them. */
            posterIsCreditor: boolean;
            feeFixed: string;
            /** Human to-asset units per 1 from-asset unit, e.g. `"0.45"`. */
            toRate: string;
            /** From-asset still accepted on this side. Saving replaces what is left. */
            remaining: string;
            expiresAtSeconds: number;
        }) =>
            favorCall("setFxOffer", [
                p.fromAsset,
                p.toAsset,
                p.posterIsCreditor,
                p.feeFixed,
                p.toRate,
                p.remaining,
                p.expiresAtSeconds,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("FX offer saved");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSetExchangeQuotes() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            assetA: number;
            assetB: number;
            /** Human units of B per 1 A. The real market rate. */
            marketRate: string;
            /** Percent taken off each direction, in ppm. 5% is 50_000. */
            spreadPpm: number;
            remainingA: string;
            remainingB: string;
            expiresAtSeconds: number;
        }) =>
            favorCall("setExchangeQuotes", [
                p.assetA,
                p.assetB,
                p.marketRate,
                p.spreadPpm,
                p.remainingA,
                p.remainingB,
                p.expiresAtSeconds,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Both rates saved");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRemoveFxOffer() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            fromAsset: number;
            toAsset: number;
            posterIsCreditor: boolean;
        }) =>
            favorCall("removeFxOffer", [
                p.fromAsset,
                p.toAsset,
                p.posterIsCreditor,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("FX offer removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSetCashQuote() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            assetId: number;
            tokenId: number;
            isOut: boolean;
            feeFixed: string;
            toRate: string;
            remaining: string;
            expiresAtSeconds: number;
        }) =>
            favorCall("setCashQuote", [
                p.assetId,
                p.tokenId,
                p.isOut,
                p.feeFixed,
                p.toRate,
                p.remaining,
                p.expiresAtSeconds,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Rate saved");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRemoveCashQuote() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            assetId: number;
            tokenId: number;
            isOut: boolean;
        }) => favorCall("removeCashQuote", [p.assetId, p.tokenId, p.isOut]),
        onSuccess: () => {
            invalidate();
            toast.success("Rate removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

async function tokensCredit(
    tokenId: number,
    amount: string,
    memo = "csh_fund",
) {
    await supervisor.functionCall({
        service: "tokens",
        intf: "user",
        method: "credit",
        params: [tokenId, FAVOR_SERVICE, amount, memo],
    });
}

async function tokensUncredit(
    tokenId: number,
    amount: string,
    memo = "csh_fund",
) {
    await supervisor.functionCall({
        service: "tokens",
        intf: "user",
        method: "uncredit",
        params: [tokenId, FAVOR_SERVICE, amount, memo],
    });
}

export function useCashFund() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: { tokenId: number; amount: string }) => {
            await tokensCredit(p.tokenId, p.amount);
            try {
                await favorCall("cashFund", [p.tokenId, p.amount]);
            } catch (e) {
                try {
                    await tokensUncredit(p.tokenId, p.amount);
                } catch {
                    throw new Error(
                        `The vault move did not finish. Tokens are still credited to ${FAVOR_SERVICE} and the rollback failed.`,
                    );
                }
                throw e;
            }
        },
        onSuccess: () => {
            invalidate();
            toast.success("Tokens added");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useCashWithdraw() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: { tokenId: number; amount: string }) =>
            favorCall("cashWithdraw", [p.tokenId, p.amount]),
        onSuccess: () => {
            invalidate();
            toast.success("Tokens withdrawn");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useCashOut() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            cashier: string;
            assetId: number;
            tokenId: number;
            amountFavor: string;
            minTokens: string;
        }) =>
            favorCall("cashOut", [
                p.cashier,
                p.assetId,
                p.tokenId,
                p.amountFavor,
                p.minTokens,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Tokens received");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useCashIn() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            cashier: string;
            assetId: number;
            tokenId: number;
            amountTokens: string;
            minFavor: string;
        }) =>
            favorCall("cashIn", [
                p.cashier,
                p.assetId,
                p.tokenId,
                p.amountTokens,
                p.minFavor,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("IOU received");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useCreateInvite() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            assetId: number;
            limit: string;
            depleteOnDebit: boolean;
        }): Promise<{ inviteId: number; inviteToken: string }> => {
            const res = (await supervisor.functionCall({
                service: FAVOR_SERVICE,
                intf: "api",
                method: "createInvite",
                params: [
                    p.assetId,
                    p.limit,
                    p.depleteOnDebit,
                ],
            })) as Record<string, unknown>;
            const inviteId = Number(res.inviteId ?? res.invite_id);
            const inviteToken = String(
                res.inviteToken ?? res.invite_token ?? "",
            );
            if (!Number.isFinite(inviteId) || !inviteToken) {
                throw new Error("Invite plugin returned an empty token");
            }
            return { inviteId, inviteToken };
        },
        onSuccess: () => {
            invalidate();
            toast.success("Invite created");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useAddAsset() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            symbol: string;
            precision: number;
            description: string;
        }) => favorCall("addAsset", [p.symbol, p.precision, p.description]),
        onSuccess: () => {
            invalidate();
            toast.success("Asset registered");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useDeleteInvite() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: { inviteId: number }) =>
            favorCall("deleteInvite", [p.inviteId]),
        onSuccess: () => {
            invalidate();
            toast.success("Invite revoked");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useConvert() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            counterparty: string;
            fromAsset: number;
            toAsset: number;
            amountFrom: string;
            minTo: string;
        }) =>
            favorCall("convert", [
                p.counterparty,
                p.fromAsset,
                p.toAsset,
                p.amountFrom,
                p.minTo,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Convert succeeded");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useTakeFx() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            poster: string;
            fromAsset: number;
            toAsset: number;
            posterIsCreditor: boolean;
            amountFrom: string;
            /** Signed human to-asset. Positive floors a receipt. Negative caps a debt. */
            toBound: string;
        }) =>
            favorCall("takeFx", [
                p.poster,
                p.fromAsset,
                p.toAsset,
                p.posterIsCreditor,
                p.amountFrom,
                p.toBound,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Trade taken");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSetRelay() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            assetA: number;
            assetB: number;
            reserveA: string;
            reserveB: string;
        }) =>
            favorCall("setRelay", [
                p.assetA,
                p.assetB,
                p.reserveA,
                p.reserveB,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Pool posted");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRemoveRelay() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: { assetA: number; assetB: number }) =>
            favorCall("removeRelay", [p.assetA, p.assetB]),
        onSuccess: () => {
            invalidate();
            toast.success("Pool removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSetTokenRelay() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            assetId: number;
            tokenId: number;
            reserveFavor: string;
            reserveTokens: string;
        }) => {
            // The service debits this credit into `{sender}/{asset}/{token}`.
            await tokensCredit(p.tokenId, p.reserveTokens, "relay");
            try {
                await favorCall("setTokenRelay", [
                    p.assetId,
                    p.tokenId,
                    p.reserveFavor,
                    p.reserveTokens,
                ]);
            } catch (e) {
                try {
                    await tokensUncredit(p.tokenId, p.reserveTokens, "relay");
                } catch {
                    throw new Error(
                        `The pool was not posted. Tokens are still credited to ${FAVOR_SERVICE} and the rollback failed.`,
                    );
                }
                throw e;
            }
        },
        onSuccess: () => {
            invalidate();
            toast.success("Token pool posted");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRemoveTokenRelay() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: { assetId: number; tokenId: number }) =>
            favorCall("removeTokenRelay", [p.assetId, p.tokenId]),
        onSuccess: () => {
            invalidate();
            toast.success("Token pool removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function usePathCash() {
    const invalidate = useInvalidateFavor();
    return useMutation({
        mutationFn: async (p: {
            route: string;
            /** Raw units. */
            amount: string;
            tokenId: number;
            recipient: string;
            minTokens: string;
            maxOwed: string;
        }) =>
            favorCall("pathCash", [
                p.route,
                p.amount,
                p.tokenId,
                p.recipient,
                p.minTokens,
                p.maxOwed,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Swap succeeded");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

