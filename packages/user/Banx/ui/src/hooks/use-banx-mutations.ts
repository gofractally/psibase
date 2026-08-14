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
                queryKey: QueryKey.clearingOffers(user),
            });
            void qc.invalidateQueries({
                queryKey: QueryKey.currencyPolicies(user),
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
        }) =>
            banxCall("setCreditLine", [
                p.debtor,
                p.assetId,
                p.limit,
                p.depleteOnDebit,
                p.interestRatePpm,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Credit line saved");
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
        }) =>
            banxCall("deposit", [
                p.depositor,
                p.assetId,
                p.amount,
                p.interestRatePpm,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Deposit booked (and netted if possible)");
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

export function usePathPay() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            hops: { account: string; assetId: number }[];
            amount: string;
            minReturn: string;
        }) =>
            banxCall("pathPay", [
                p.hops.map((h) => ({
                    account: h.account,
                    assetId: h.assetId,
                })),
                p.amount,
                p.minReturn,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Transfer succeeded");
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
        onError: (e: Error) => toast.error(e.message),
        onSuccess: () => toast.success("Path found"),
    });
}

export function useSetClearingOffer() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            counterparty: string;
            assetId: number;
            feeFixed: string;
            feePercentPpm: number;
            maxLineAprPpm: number;
            forwardEnabled: boolean;
            expiresAtSeconds: number;
        }) =>
            banxCall("setClearingOffer", [
                p.counterparty,
                p.assetId,
                p.feeFixed,
                p.feePercentPpm,
                p.maxLineAprPpm,
                p.forwardEnabled,
                p.expiresAtSeconds,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Clearing offer saved");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

/** @deprecated */
export const useSetRoutingPolicy = () => {
    const m = useSetClearingOffer();
    return {
        ...m,
        mutate: (
            p: {
                creditor: string;
                assetId: number;
                hopFeeFixed: string;
                hopFeePercentPpm: number;
                maxAcceptRatePpm: number;
                expiresAtSeconds: number;
                forwardEnabled?: boolean;
            },
            opts?: Parameters<typeof m.mutate>[1],
        ) =>
            m.mutate(
                {
                    counterparty: p.creditor,
                    assetId: p.assetId,
                    feeFixed: p.hopFeeFixed,
                    feePercentPpm: p.hopFeePercentPpm,
                    maxLineAprPpm: p.maxAcceptRatePpm,
                    forwardEnabled: p.forwardEnabled ?? true,
                    expiresAtSeconds: p.expiresAtSeconds,
                },
                opts,
            ),
    };
};

export function useSetGlobalClearingOffer() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            assetId: number;
            feeFixed: string;
            feePercentPpm: number;
            maxLineAprPpm: number;
            forwardEnabled: boolean;
            expiresAtSeconds: number;
        }) =>
            banxCall("setGlobalClearingOffer", [
                p.assetId,
                p.feeFixed,
                p.feePercentPpm,
                p.maxLineAprPpm,
                p.forwardEnabled,
                p.expiresAtSeconds,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Global clearing offer saved");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

/** @deprecated */
export const useSetGlobalRoutingPolicy = () => {
    const m = useSetGlobalClearingOffer();
    return {
        ...m,
        mutate: (
            p: {
                assetId: number;
                hopFeeFixed: string;
                hopFeePercentPpm: number;
                maxAcceptRatePpm: number;
                expiresAtSeconds: number;
                forwardEnabled?: boolean;
            },
            opts?: Parameters<typeof m.mutate>[1],
        ) =>
            m.mutate(
                {
                    assetId: p.assetId,
                    feeFixed: p.hopFeeFixed,
                    feePercentPpm: p.hopFeePercentPpm,
                    maxLineAprPpm: p.maxAcceptRatePpm,
                    forwardEnabled: p.forwardEnabled ?? true,
                    expiresAtSeconds: p.expiresAtSeconds,
                },
                opts,
            ),
    };
};

export function useRemoveClearingOffer() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: { counterparty: string; assetId: number }) =>
            banxCall("removeClearingOffer", [p.counterparty, p.assetId]),
        onSuccess: () => {
            invalidate();
            toast.success("Clearing offer removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

/** @deprecated */
export function useRemoveRoutingPolicy() {
    const m = useRemoveClearingOffer();
    return {
        ...m,
        mutate: (
            p: { creditor: string; assetId: number },
            opts?: Parameters<typeof m.mutate>[1],
        ) => m.mutate({ counterparty: p.creditor, assetId: p.assetId }, opts),
    };
}

export function useRemoveGlobalClearingOffer() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: { assetId: number }) =>
            banxCall("removeGlobalClearingOffer", [p.assetId]),
        onSuccess: () => {
            invalidate();
            toast.success("Global clearing offer removed");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

/** @deprecated */
export const useRemoveGlobalRoutingPolicy = useRemoveGlobalClearingOffer;

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

export function useAccrue() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            creditor: string;
            debtor: string;
            assetId: number;
        }) => banxCall("accrue", [p.creditor, p.debtor, p.assetId]),
        onSuccess: () => {
            invalidate();
            toast.success("Interest accrued");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}
