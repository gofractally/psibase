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
                queryKey: QueryKey.routingPolicies(user),
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
            toast.success("Path payment succeeded");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSetRoutingPolicy() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            creditor: string;
            assetId: number;
            hopFeeFixed: string;
            hopFeePercentPpm: number;
            maxAcceptRatePpm: number;
            expiresAtSeconds: number;
        }) =>
            banxCall("setRoutingPolicy", [
                p.creditor,
                p.assetId,
                p.hopFeeFixed,
                p.hopFeePercentPpm,
                p.maxAcceptRatePpm,
                p.expiresAtSeconds,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Routing override saved");
        },
        onError: (e: Error) => toast.error(e.message),
    });
}

export function useSetGlobalRoutingPolicy() {
    const invalidate = useInvalidateBanx();
    return useMutation({
        mutationFn: async (p: {
            assetId: number;
            hopFeeFixed: string;
            hopFeePercentPpm: number;
            maxAcceptRatePpm: number;
            expiresAtSeconds: number;
        }) =>
            banxCall("setGlobalRoutingPolicy", [
                p.assetId,
                p.hopFeeFixed,
                p.hopFeePercentPpm,
                p.maxAcceptRatePpm,
                p.expiresAtSeconds,
            ]),
        onSuccess: () => {
            invalidate();
            toast.success("Global routing policy saved");
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
