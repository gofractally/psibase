import { queryClient } from "@shared/lib/query-client";
import { supervisor } from "@shared/lib/supervisor";

import QueryKey from "../../lib/query-keys";

import {
    type NameMarketConfigInput,
    ppmToPct,
} from "@/lib/name-market-config";
import { PREMIUM_MARKET_DEFAULT_WINDOW_SECONDS } from "@/lib/premium-name-market-defaults";
import { CONFIG } from "@/lib/services";

import { usePluginMutation } from "@/hooks/use-plugin-mutation";

/** `[length, initialPrice, target, floorPrice, increasePpm, decreasePpm]` */
type AddMarketParams = [number, string, number, string, number, number];

function addParamsToConfig([
    length,
    initialPrice,
    target,
    floorPrice,
    increasePpm,
    decreasePpm,
]: AddMarketParams): NameMarketConfigInput {
    return {
        length,
        windowSeconds: PREMIUM_MARKET_DEFAULT_WINDOW_SECONDS,
        target,
        floorPrice,
        increasePct: ppmToPct(increasePpm),
        decreasePct: ppmToPct(decreasePpm),
        enabled: true,
        initialPrice: initialPrice,
    };
}

export const useAddPremiumNameMarket = () =>
    usePluginMutation<AddMarketParams>(
        {
            service: CONFIG,
            intf: "nameMarket",
            method: "configureMarkets",
        },
        {
            error: "Failed to add premium name market",
            loading: "Adding premium name market…",
            success: "Premium name market added",
            isStagable: true,
            customMutationFn: async (params) => {
                await supervisor.functionCall({
                    service: CONFIG,
                    intf: "nameMarket",
                    method: "configureMarkets",
                    params: [[addParamsToConfig(params)]],
                });
            },
            onSuccess: (_, __) => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumNameMarkets(),
                });
            },
        },
    );
