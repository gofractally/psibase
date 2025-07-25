import { CONFIG } from "@/lib/services";

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
        },
    );
