import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { supervisor } from "@/supervisor";

import { checkLastTx } from "@/lib/checkStaging";
import { PREMIUM_MARKET_DEFAULTS } from "@/lib/premium-market-defaults";
import { zAccount } from "@shared/lib/schemas/account";
import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";

import { toast } from "@shared/shadcn/ui/sonner";

const PREM_ACCOUNTS = zAccount.parse("prem-accounts");

export const useBootstrapDefaultPremiumMarkets = () => {
    const navigate = useNavigate();

    return useMutation({
        mutationKey: [
            PREM_ACCOUNTS,
            "market-admin",
            "bootstrapDefaultPremiumMarkets",
        ] as const,
        onMutate: (): string | number =>
            toast.loading("Configuring premium markets 1–9…"),
        mutationFn: async () => {
            for (let len = 1; len <= 9; len++) {
                await supervisor.functionCall({
                    service: PREM_ACCOUNTS,
                    intf: "market-admin",
                    method: "create",
                    params: [
                        len,
                        PREMIUM_MARKET_DEFAULTS.initialPrice,
                        PREMIUM_MARKET_DEFAULTS.target,
                        PREMIUM_MARKET_DEFAULTS.floorPrice,
                    ],
                });
            }
        },
        onError: (errorObj, _vars, id) => {
            console.error({ errorObj }, "bootstrap premium markets");
            toast.error("Failed to configure default markets", {
                description:
                    errorObj instanceof Error
                        ? errorObj.message
                        : String(errorObj),
                id,
            });
        },
        onSuccess: async (_data, _vars, id) => {
            void queryClient.invalidateQueries({
                queryKey: QueryKey.premiumConfiguredMarkets(),
            });
            const lastTx = await checkLastTx();
            if (lastTx.type == "executed") {
                toast.success("Premium markets 1–9 configured", {
                    id,
                    description: "Change is live.",
                });
            } else {
                toast.success("Premium markets 1–9 proposed", {
                    id,
                    description: "Change is proposed.",
                    action: {
                        label: "View",
                        onClick: () => {
                            navigate(
                                `/pending-transactions/${lastTx.stagedId}`,
                            );
                        },
                    },
                });
            }
        },
    });
};
