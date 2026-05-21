import { useQuery } from "@tanstack/react-query";
import { useDebounceValue } from "usehooks-ts";

import QueryKey from "@/lib/query-keys";

import { supervisor } from "@shared/lib/supervisor";

export const useValidatedMaxCost = (
    maxCost: string,
    tokenId: number | undefined,
) => {
    const [debouncedMaxCost] = useDebounceValue(maxCost.trim(), 300);

    return useQuery({
        queryKey: QueryKey.premValidatedMaxCost(tokenId, debouncedMaxCost),
        queryFn: async () => {
            const raw = await supervisor.functionCall({
                service: "tokens",
                plugin: "plugin",
                intf: "helpers",
                method: "decimalToU64",
                params: [tokenId, debouncedMaxCost],
            });

            return typeof raw === "bigint" ? raw : BigInt(raw as number | string);
        },
        enabled: tokenId !== undefined && debouncedMaxCost.length > 0,
    });
};
