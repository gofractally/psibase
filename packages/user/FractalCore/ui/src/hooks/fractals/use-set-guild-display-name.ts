import { fractalCorePlugin } from "@/lib/plugin";

import { usePluginFunctionCallMutation } from "../use-plugin-function-call-mutation";

export const useSetGuildDisplayName = () =>
    usePluginFunctionCallMutation(fractalCorePlugin.adminGuild.setDisplayName, {
        toast: {
            error: "Failed setting display name",
            loading: "Setting display name",
            success: "Set display name",
        },
    });
