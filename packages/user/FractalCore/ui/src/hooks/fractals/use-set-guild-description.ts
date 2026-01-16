import { fractalCorePlugin } from "@/lib/plugin";

import { usePluginFunctionCallMutation } from "../use-plugin-function-call-mutation";

export const useSetGuildDescription = () =>
    usePluginFunctionCallMutation(fractalCorePlugin.adminGuild.setDescription, {
        toast: {
            error: "Failed setting description",
            loading: "Setting description",
            success: "Set description",
        },
    });
