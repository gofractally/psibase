import { fractalCorePlugin } from "@/lib/plugin";

import { usePluginMutation } from "../use-plugin-mutation";

export const useInitToken = () =>
    usePluginMutation(fractalCorePlugin.adminFractal.initToken, {
        loading: "Intialising token..",
        success: "Intialised token",
    });
