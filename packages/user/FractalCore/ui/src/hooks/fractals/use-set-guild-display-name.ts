import { fractalCorePlugin } from "@/lib/constants";
import { Account } from "@/lib/zod/Account";

import { usePluginMutation } from "../use-plugin-mutation";

export const useSetGuildDisplayName = () => {
    return usePluginMutation<[Account, string]>(
        fractalCorePlugin.adminGuild.setDisplayName,
        {
            error: "Failed setting display name",
            loading: "Setting display name",
            success: "Set display name",
        },
    );
};
