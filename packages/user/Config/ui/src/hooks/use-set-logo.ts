import { queryClient } from "@/queryClient";
import QueryKey from "@/lib/queryKeys";
import { CONFIG } from "@/lib/services";

import { usePluginMutation } from "./use-plugin-mutation";
import type { TxStatus } from "@/lib/checkStaging";

export const useSetLogo = () =>
    usePluginMutation<[Uint8Array]>(
        {
            intf: "branding",
            service: CONFIG,
            method: "uploadNetworkLogo",
        },
        {
            error: "Failed uploading icon",
            loading: "Uploading icon",
            success: "Uploaded icon",
            isStagable: true,
            onSuccess: (_params, status: TxStatus) => {
                if (status.type === "executed") {
                    queryClient.invalidateQueries({ queryKey: QueryKey.brandingFiles() });
                }
            },
        },
    );
