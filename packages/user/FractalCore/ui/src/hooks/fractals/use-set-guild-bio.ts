import { fractalCorePlugin } from "@/lib/plugin";

import { usePluginMutation } from "../use-plugin-mutation";

export const useSetGuildBio = () =>
    usePluginMutation(fractalCorePlugin.adminGuild.setBio, {
        error: "Failed setting bio",
        loading: "Setting bio",
        success: "Set bio",
    });
