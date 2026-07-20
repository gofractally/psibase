import type { TxStatus } from "@/lib/check-staging";

import QueryKey from "@/lib/query-keys";
import { CONFIG } from "@/lib/services";

import { queryClient } from "@shared/lib/query-client";

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
