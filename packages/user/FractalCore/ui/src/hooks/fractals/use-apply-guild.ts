import { fractalCorePlugin } from "@/lib/plugin";

import { usePluginMutation } from "../use-plugin-mutation";

export const useApplyGuild = () =>
    usePluginMutation(fractalCorePlugin.userGuild.applyGuild, {
        loading: "Applying for guild membership",
        error: "Failed applying for guild membership",
        success: "Applied for guild membership",
    });
