import { fractalCorePlugin } from "@/lib/plugin";

import { usePluginMutation } from "../use-plugin-mutation";

export const useSetGuildDisplayName = () =>
    usePluginMutation(fractalCorePlugin.adminGuild.setDisplayName, {
        error: "Failed setting display name",
        loading: "Setting display name",
        success: "Set display name",
    });
