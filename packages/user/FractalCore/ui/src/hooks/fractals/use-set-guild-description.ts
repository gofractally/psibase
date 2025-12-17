import { fractalCorePlugin } from "@/lib/plugin";

import { usePluginMutation } from "../use-plugin-mutation";

export const useSetGuildDescription = () =>
    usePluginMutation(fractalCorePlugin.adminGuild.setDescription, {
        error: "Failed setting description",
        loading: "Setting description",
        success: "Set description",
    });
