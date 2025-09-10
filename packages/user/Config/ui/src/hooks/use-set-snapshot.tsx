import { CONFIG } from "@/lib/services";

import { usePluginMutation } from "./use-plugin-mutation";
import QueryKey from "@/lib/queryKeys";
import { queryClient } from "@/queryClient";

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
                    queryClient.setQueryData(QueryKey.snapshotSeconds(), seconds[0]);
                }
            },
        },
    );
