// import { queryClient } from "@/queryClient";

// import QueryKey from "@/lib/queryKeys";
import { CONFIG } from "@/lib/services";

import { usePluginMutation } from "./use-plugin-mutation";

export const useSetSnapshot = () =>
    usePluginMutation<[number]>(
        {
            service: CONFIG,
            method: "setSnapshotTime",
            intf: "settings",
        },
        {
            error: "Failed setting snapshot interval",
            loading: "Setting snapshot interval..",
            success: "Set snapshot interval",
            isStagable: true,
            onSuccess: (seconds, status) => {
                if (status.type == "executed") {
                    console.log(seconds, 'seconds')
                    // queryClient.setQueryData(QueryKey., networkName);
                }
            },
        },
    );
