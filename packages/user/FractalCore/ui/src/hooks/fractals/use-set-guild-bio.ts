import { fractalCorePlugin } from "@/lib/plugin";

import { usePluginFunctionCallMutation } from "../use-plugin-function-call-mutation";

export const useSetGuildBio = () =>
    usePluginFunctionCallMutation(fractalCorePlugin.adminGuild.setBio, {
        toast: {
            error: "Failed setting bio",
            loading: "Setting bio",
            success: "Set bio",
        },
    });
