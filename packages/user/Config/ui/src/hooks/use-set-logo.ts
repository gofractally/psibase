import type { TxStatus } from "@/lib/check-staging";

import QueryKey from "@/lib/query-keys";
import { CONFIG } from "@/lib/services";

import { NETWORK_LOGO_OPTIONS, prepareImage } from "@shared/lib/prepare-image";
import { queryClient } from "@shared/lib/query-client";
import { supervisor } from "@shared/lib/supervisor";

import { usePluginMutation } from "./use-plugin-mutation";

const refreshLogo = (_params: unknown, status: TxStatus) => {
    if (status.type === "executed") {
        queryClient.invalidateQueries({
            queryKey: QueryKey.brandingFiles(),
        });
    }
};

export const useSetLogo = () =>
    usePluginMutation<[file: File]>(
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
            customMutationFn: async ([file]) => {
                const logo = await prepareImage(file, NETWORK_LOGO_OPTIONS);
                await supervisor.functionCall({
                    service: CONFIG,
                    intf: "branding",
                    method: "uploadNetworkLogo",
                    params: [logo],
                });
            },
            onSuccess: refreshLogo,
        },
    );

export const useRemoveLogo = () =>
    usePluginMutation<[]>(
        {
            intf: "branding",
            service: CONFIG,
            method: "removeNetworkLogo",
        },
        {
            error: "Failed removing icon",
            loading: "Removing icon",
            success: "Removed icon",
            isStagable: true,
            onSuccess: refreshLogo,
        },
    );
