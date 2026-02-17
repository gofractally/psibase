import { fractalCorePlugin } from "@/lib/plugin";

import { usePluginMutation } from "../use-plugin-mutation";

export const useCreateGuildInvite = () =>
    usePluginMutation(fractalCorePlugin.userGuild.createGuildInvite, {
        loading: "Creating guild invite",
        error: "Failed creating guild invite",
        success: "Created guild invite",
        isStagable: false
    });
