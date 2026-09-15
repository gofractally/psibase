import { useQuery } from "@tanstack/react-query";

import {
    type SystemTokenInfo,
    toSystemTokenInfo,
} from "@shared/hooks/use-system-token";
import { callPluginFunction, config } from "@shared/lib/plugins";
import QueryKey from "@shared/lib/query-keys";

export const useSystemToken = () =>
    useQuery<SystemTokenInfo | null>({
        queryKey: QueryKey.systemToken(),
        queryFn: async () =>
            toSystemTokenInfo(
                await callPluginFunction(config.tokens.getSystemToken, []),
            ),
    });
