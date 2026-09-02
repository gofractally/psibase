import { useMutation, useQueryClient } from "@tanstack/react-query";

import { BANX_SERVICE } from "@/lib/constants";
import { QueryKey } from "@/lib/query-keys";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

function useInvalidateBanx() {
    const qc = useQueryClient();
    const { data: user } = useCurrentUser();
    return () => {
        void qc.invalidateQueries({ queryKey: QueryKey.assets() });
        if (user) {
            void qc.invalidateQueries({ queryKey: QueryKey.creditLines(user) });
            void qc.invalidateQueries({ queryKey: QueryKey.obligations(user) });
            void qc.invalidateQueries({
                queryKey: QueryKey.forwardOffers(user),
            });
            void qc.invalidateQueries({
                queryKey: QueryKey.claimOffers(user),
            });
            void qc.invalidateQueries({
                queryKey: QueryKey.currencyPolicies(user),
            });
            void qc.invalidateQueries({
                queryKey: QueryKey.requests(user),
            });
            void qc.invalidateQueries({ queryKey: QueryKey.invites(user) });
            void qc.invalidateQueries({ queryKey: ["banx", "cashQuotes"] });
            void qc.invalidateQueries({
                queryKey: QueryKey.cashVault(user),
            });
        }
    };
}

async function banxCall(method: string, params: unknown[]) {
    await supervisor.functionCall({
        service: BANX_SERVICE,
        intf: "api",
        method,
        params,
    });
}

export function useSetCreditLine() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            debtor: string;
            assetId: number;
            /** Human decimal, e.g. `"100.00"` */
            limit: string;
            depleteOnDebit: boolean;
            interestRatePpm: number;
            /** Interest-free window in seconds after 0→positive. */
            graceSeconds: number;
        }) =>
            banxCall("setCreditLine", [
                p.debtor,
                p.assetId,
                p.limit,
                p.depleteOnDebit,
                p.interestRatePpm,
                p.graceSeconds,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Credit line saved");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRemoveCreditLine() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: { debtor: string; assetId: number }) =>
            banxCall("removeCreditLine", [p.debtor, p.assetId]),
        onSuccess: () => {
            invalidate();
            toast.success("Credit line removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useDeposit() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            depositor: string;
            assetId: number;
            amount: string;
            interestRatePpm: number;
            requestId?: number;
        }) =>
            banxCall("deposit", [
                p.depositor,
                p.assetId,
                p.amount,
                p.interestRatePpm,
                p.requestId ?? 0,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Deposit booked (and netted if possible)");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useCreateRequest() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            kind: number;
            counterparty: string;
            assetId: number;
            amount: string;
            memo: string;
            expiresAtSeconds: number;
        }) =>
            banxCall("createRequest", [
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

export function useFulfillSettle() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            requestId: number;
            assetId: number;
            amount: string;
        }) =>
            banxCall("fulfillSettle", [p.requestId, p.assetId, p.amount]),
        onSuccess: () => {
            invalidate();
            toast.success("Settled against authorization");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useCancelRequest() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (id: number) => banxCall("cancelRequest", [id]),
        onSuccess: () => {
            invalidate();
            toast.success("Request cancelled");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useNet() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            counterparty: string;
            assetId: number;
            maxAmount: string;
        }) => banxCall("net", [p.counterparty, p.assetId, p.maxAmount]),
        onSuccess: () => {
            invalidate();
            toast.success("Netting applied");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useForgive() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            debtor: string;
            assetId: number;
            amount: string;
        }) => banxCall("forgive", [p.debtor, p.assetId, p.amount]),
        onSuccess: () => {
            invalidate();
            toast.success("Claim written off");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function usePathPay() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            hops: { account: string; assetId: number }[];
            amount: string;
            minReturn: string;
            requestId?: number;
        }) =>
            banxCall("pathPay", [
                p.hops.map((h) => ({
                    account: h.account,
                    assetId: h.assetId,
                })),
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

export function usePayInvoice() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            hops: { account: string; assetId: number }[];
            maxSpend: string;
            requestId: number;
        }) =>
            banxCall("payInv", [
                p.hops.map((h) => ({
                    account: h.account,
                    assetId: h.assetId,
                })),
                p.maxSpend,
                p.requestId,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Invoice paid");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export type PathHopQuote = {
    account: string;
    assetId: number;
    /** Notional drawn on this hop after fees (hop asset). */
    amount: string;
    /** Routing fee on this hop (hop asset). `"0"` for hop 0. */
    hopFee: string;
    /** FX fixed fee into this hop (prior asset). `"0"` if no convert. */
    fxFee: string;
    /** Prior asset when FX convert happened. */
    fxFromAsset?: number;
};

export type PathQuote = {
    hops: PathHopQuote[];
    /** Amount to draw on first hop (from-asset). */
    amountIn: string;
    /** Residual after fees (last-hop asset). */
    amountOut: string;
    /** Suggested path_pay min-return (last-hop asset). */
    minReturn: string;
};

type RawHop = {
    account: string;
    assetId?: number;
    asset_id?: number;
    amount?: string;
    hopFee?: string;
    hop_fee?: string;
    fxFee?: string;
    fx_fee?: string;
    fxFromAsset?: number | null;
    fx_from_asset?: number | null;
};

/** Off-chain path discovery (scoped graph + TokenSwap-style search). */
export function useQuotePath() {
    return useMutation({
        mutationFn: async (p: {
            fromAccount: string;
            toAccount: string;
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
            // Always pass a real boolean (some bridges drop/omit `false`).
            const exactOut = p.exactOut === true;
            const res = (await supervisor.functionCall({
                service: BANX_SERVICE,
                intf: "api",
                method: "quotePath",
                params: [
                    p.fromAccount,
                    p.toAccount,
                    p.amount,
                    p.fromAsset,
                    p.toAsset,
                    p.maxHops,
                    exactOut,
                ],
            })) as Record<string, unknown> & {
                hops: RawHop[];
            };
            // Prefer camelCase (jco); fall back to snake_case if present.
            const amountIn = String(
                res.amountIn ?? res.amount_in ?? p.amount,
            );
            const amountOut = String(res.amountOut ?? res.amount_out ?? "");
            const minReturn = String(
                res.minReturn ?? res.min_return ?? amountOut,
            );
            return {
                hops: (res.hops ?? []).map((h) => {
                    const fxFrom =
                        h.fxFromAsset ?? h.fx_from_asset ?? undefined;
                    return {
                        account: h.account,
                        assetId: Number(h.assetId ?? h.asset_id),
                        amount: String(h.amount ?? ""),
                        hopFee: String(h.hopFee ?? h.hop_fee ?? "0"),
                        fxFee: String(h.fxFee ?? h.fx_fee ?? "0"),
                        fxFromAsset:
                            fxFrom === null || fxFrom === undefined
                                ? undefined
                                : Number(fxFrom),
                    };
                }),
                amountIn,
                amountOut,
                minReturn,
            };
        },
    });
}

export function useSetForwardOffer() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            nextHop: string;
            assetId: number;
            feeFixed: string;
            feePercentPpm: number;
            maxLineAprPpm: number;
            expiresAtSeconds: number;
            allowUnknown: boolean;
        }) => {
            await banxCall("setForwardOffer", [
                p.nextHop,
                p.assetId,
                p.feeFixed,
                p.feePercentPpm,
                p.maxLineAprPpm,
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
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            assetId: number;
            feeFixed: string;
            feePercentPpm: number;
            maxLineAprPpm: number;
            expiresAtSeconds: number;
            allowUnknown: boolean;
        }) => {
            await banxCall("setGlobalForwardOffer", [
                p.assetId,
                p.feeFixed,
                p.feePercentPpm,
                p.maxLineAprPpm,
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
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: { nextHop: string; assetId: number }) =>
            banxCall("removeForwardOffer", [p.nextHop, p.assetId]),
        onSuccess: () => {
            invalidate();
            toast.success("Path-forward offer removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRemoveGlobalForwardOffer() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: { assetId: number }) =>
            banxCall("removeGlobalForwardOffer", [p.assetId]),
        onSuccess: () => {
            invalidate();
            toast.success("Global path-forward offer removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSetBuyClaimOffer() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            debtor: string;
            assetId: number;
            feeFixed: string;
            feePercentPpm: number;
            expiresAtSeconds: number;
        }) =>
            banxCall("setBuyClaimOffer", [
                p.debtor,
                p.assetId,
                p.feeFixed,
                p.feePercentPpm,
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
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            assetId: number;
            feeFixed: string;
            feePercentPpm: number;
            expiresAtSeconds: number;
        }) =>
            banxCall("setGlobalBuyClaimOffer", [
                p.assetId,
                p.feeFixed,
                p.feePercentPpm,
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
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: { debtor: string; assetId: number }) =>
            banxCall("removeBuyClaimOffer", [p.debtor, p.assetId]),
        onSuccess: () => {
            invalidate();
            toast.success("Buy-claim offer removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRemoveGlobalBuyClaimOffer() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: { assetId: number }) =>
            banxCall("removeGlobalBuyClaimOffer", [p.assetId]),
        onSuccess: () => {
            invalidate();
            toast.success("Global buy-claim offer removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSetSellClaimOffer() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            debtor: string;
            assetId: number;
            feeFixed: string;
            feePercentPpm: number;
            expiresAtSeconds: number;
        }) =>
            banxCall("setSellClaimOffer", [
                p.debtor,
                p.assetId,
                p.feeFixed,
                p.feePercentPpm,
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
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            assetId: number;
            feeFixed: string;
            feePercentPpm: number;
            expiresAtSeconds: number;
        }) =>
            banxCall("setGlobalSellClaimOffer", [
                p.assetId,
                p.feeFixed,
                p.feePercentPpm,
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
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: { debtor: string; assetId: number }) =>
            banxCall("removeSellClaimOffer", [p.debtor, p.assetId]),
        onSuccess: () => {
            invalidate();
            toast.success("Sell-claim offer removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRemoveGlobalSellClaimOffer() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: { assetId: number }) =>
            banxCall("removeGlobalSellClaimOffer", [p.assetId]),
        onSuccess: () => {
            invalidate();
            toast.success("Global sell-claim offer removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSellClaim() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            buyer: string;
            debtor: string;
            assetId: number;
            amount: string;
        }) => banxCall("sellClaim", [p.buyer, p.debtor, p.assetId, p.amount]),
        onSuccess: () => {
            invalidate();
            toast.success("Claim sold");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useBuyClaim() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            seller: string;
            debtor: string;
            assetId: number;
            amount: string;
        }) => banxCall("buyClaim", [p.seller, p.debtor, p.assetId, p.amount]),
        onSuccess: () => {
            invalidate();
            toast.success("Claim bought");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSetCurrencyPolicy() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            fromAsset: number;
            toAsset: number;
            feeFixed: string;
            /** Human to-asset units per 1 from-asset unit, e.g. `"0.45"`. */
            toRate: string;
            toInterestRatePpm: number;
            expiresAtSeconds: number;
        }) =>
            banxCall("setCurrencyPolicy", [
                p.fromAsset,
                p.toAsset,
                p.feeFixed,
                p.toRate,
                p.toInterestRatePpm,
                p.expiresAtSeconds,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Currency policy saved");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRemoveCurrencyPolicy() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: { fromAsset: number; toAsset: number }) =>
            banxCall("removeCurrencyPolicy", [p.fromAsset, p.toAsset]),
        onSuccess: () => {
            invalidate();
            toast.success("Currency policy removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSetCashQuote() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            assetId: number;
            tokenId: number;
            isOut: boolean;
            feeFixed: string;
            toRate: string;
            expiresAtSeconds: number;
        }) =>
            banxCall("setCashQuote", [
                p.assetId,
                p.tokenId,
                p.isOut,
                p.feeFixed,
                p.toRate,
                p.expiresAtSeconds,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Cash quote saved");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useRemoveCashQuote() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            assetId: number;
            tokenId: number;
            isOut: boolean;
        }) => banxCall("removeCashQuote", [p.assetId, p.tokenId, p.isOut]),
        onSuccess: () => {
            invalidate();
            toast.success("Cash quote removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

async function tokensCredit(tokenId: number, amount: string) {
    await supervisor.functionCall({
        service: "tokens",
        intf: "user",
        method: "credit",
        params: [tokenId, BANX_SERVICE, amount, "csh_fund"],
    });
}

export function useCashFund() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: { tokenId: number; amount: string }) => {
            await tokensCredit(p.tokenId, p.amount);
            await banxCall("cashFund", [p.tokenId, p.amount]);
        },
        onSuccess: () => {
            invalidate();
            toast.success("Vault funded");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useCashWithdraw() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: { tokenId: number; amount: string }) =>
            banxCall("cashWithdraw", [p.tokenId, p.amount]),
        onSuccess: () => {
            invalidate();
            toast.success("Withdrawn from vault");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useCashOut() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            cashier: string;
            assetId: number;
            tokenId: number;
            amountBanx: string;
            minTokens: string;
        }) =>
            banxCall("cashOut", [
                p.cashier,
                p.assetId,
                p.tokenId,
                p.amountBanx,
                p.minTokens,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Cashed out");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useCashIn() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            cashier: string;
            assetId: number;
            tokenId: number;
            amountTokens: string;
            minBanx: string;
        }) =>
            banxCall("cashIn", [
                p.cashier,
                p.assetId,
                p.tokenId,
                p.amountTokens,
                p.minBanx,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Cashed in");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useCreateInvite() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            assetId: number;
            limit: string;
            depleteOnDebit: boolean;
            interestRatePpm: number;
            graceSeconds: number;
        }): Promise<{ inviteId: number; inviteToken: string }> => {
            const res = (await supervisor.functionCall({
                service: BANX_SERVICE,
                intf: "api",
                method: "createInvite",
                params: [
                    p.assetId,
                    p.limit,
                    p.depleteOnDebit,
                    p.interestRatePpm,
                    p.graceSeconds,
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

export function useDeleteInvite() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: { inviteId: number }) =>
            banxCall("deleteInvite", [p.inviteId]),
        onSuccess: () => {
            invalidate();
            toast.success("Invite revoked");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useConvert() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            counterparty: string;
            fromAsset: number;
            toAsset: number;
            amountFrom: string;
            minTo: string;
        }) =>
            banxCall("convert", [
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

