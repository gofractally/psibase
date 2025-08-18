import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";

import { usePluginMutation } from "./use-plugin-mutation";

export const useSetAccountSources = () =>
    usePluginMutation<[string[]]>(
        {
            service: "config",
            intf: "packaging",
            method: "setAccountSources",
        },
        {
            error: "Failed setting sources",
            loading: "Setting sources...",
            success: "Set sources",
            isStagable: true,
            onSuccess: (_, status) => {
                if (status.type == "executed") {
                    queryClient.invalidateQueries({
                        queryKey: QueryKey.availablePackages(),
                    });
                    queryClient.invalidateQueries({
                        queryKey: QueryKey.installedPackages(),
                    });
                }
            },
        },
    );
