import QueryKey from "@/lib/query-keys";
import { CONFIG } from "@/lib/services";

import { queryClient } from "@shared/lib/query-client";

import { usePluginMutation } from "./use-plugin-mutation";

export const useUnregResProvider = () =>
    usePluginMutation<[]>(
        {
            service: CONFIG,
            method: "unregResProvider",
            intf: "virtualServer",
        },
        {
            error: "Failed unregistering resource provider",
            loading: "Unregistering resource provider",
            success: "Unregistered resource provider",
            isStagable: false,
            onSuccess: () => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.resourceProviders(),
                });
            },
        },
    );
