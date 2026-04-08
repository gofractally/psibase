import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { supervisor } from "@/supervisor";

import { checkLastTx } from "@/lib/checkStaging";
import { PREMIUM_MARKET_DEFAULTS } from "@/lib/premium-name-market-defaults";
import { MAX_PREMIUM_NAME_LENGTH, MIN_PREMIUM_NAME_LENGTH } from "@shared/lib/schemas/account";
import { zAccount } from "@shared/lib/schemas/account";
import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";

import { toast } from "@shared/shadcn/ui/sonner";

const PREM_ACCOUNTS = zAccount.parse("prem-accounts");

export const useBootstrapDefaultPremiumNameMarkets = () => {
    const navigate = useNavigate();
    const nameLengthRangeStr = `${MIN_PREMIUM_NAME_LENGTH}–${MAX_PREMIUM_NAME_LENGTH}`;

    return useMutation({
        mutationKey: [
            PREM_ACCOUNTS,
            "market-admin",
            "bootstrapDefaultPremiumNameMarkets",
        ] as const,
        onMutate: (): string | number =>
            toast.loading(`Configuring premium name markets ${MIN_PREMIUM_NAME_LENGTH}-9…`),
        mutationFn: async () => {
            for (let len = MIN_PREMIUM_NAME_LENGTH; len <= MAX_PREMIUM_NAME_LENGTH; len++) {
                await supervisor.functionCall({
                    service: PREM_ACCOUNTS,
                    intf: "marketAdmin",
                    method: "create",
                    params: [
                        len,
                        PREMIUM_MARKET_DEFAULTS.initialPrice,
                        PREMIUM_MARKET_DEFAULTS.target,
                        PREMIUM_MARKET_DEFAULTS.floorPrice,
                        PREMIUM_MARKET_DEFAULTS.increasePpm,
                        PREMIUM_MARKET_DEFAULTS.decreasePpm,
                    ],
                });
            }
        },
        onError: (errorObj, _vars, id) => {
            console.error({ errorObj }, "bootstrap default premium name markets");
            toast.error("Failed to configure default premium name markets", {
                description:
                    errorObj instanceof Error
                        ? errorObj.message
                        : String(errorObj),
                id,
            });
        },
        onSuccess: async (_data, _vars, id) => {
            void queryClient.invalidateQueries({
                queryKey: QueryKey.premiumNameMarkets(),
            });
            const lastTx = await checkLastTx();
            if (lastTx.type == "executed") {
                toast.success(`Premium name markets ${nameLengthRangeStr} configured`, {
                    id,
                    description: "Change is live.",
                });
            } else {
                toast.success(`Premium name markets ${nameLengthRangeStr} proposed`, {
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
