import type { TxStatus } from "@/lib/checkStaging";

import QueryKey from "@/lib/queryKeys";
import { CONFIG } from "@/lib/services";

import { queryClient } from "@shared/lib/queryClient";

import { usePluginMutation } from "./use-plugin-mutation";

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
                    queryClient.invalidateQueries({
                        queryKey: QueryKey.brandingFiles(),
                    });
                }
            },
        },
    );
