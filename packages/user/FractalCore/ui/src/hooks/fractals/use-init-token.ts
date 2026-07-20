import { fractalCorePlugin } from "@/lib/plugin";

import { usePluginMutation } from "../use-plugin-mutation";

export const useInitToken = (onSuccess?: () => void) =>
    usePluginMutation(fractalCorePlugin.adminFractal.initToken, {
        loading: "Intialising token..",
        success: "Intialised token",
        onSuccess
    });
