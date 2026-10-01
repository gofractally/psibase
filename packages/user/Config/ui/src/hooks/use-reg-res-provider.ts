import QueryKey from "@/lib/query-keys";
import { CONFIG } from "@/lib/services";

import { queryClient } from "@shared/lib/query-client";

import { usePluginMutation } from "./use-plugin-mutation";

export const useRegResProvider = () =>
    usePluginMutation<[string, string[]]>(
        {
            service: CONFIG,
            method: "regResProvider",
            intf: "virtualServer",
        },
        {
            error: "Failed registering resource provider",
            loading: "Registering resource provider",
            success: "Registered resource provider",
            isStagable: true,
            onSuccess: () => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.resourceProviders(),
                });
            },
        },
    );
