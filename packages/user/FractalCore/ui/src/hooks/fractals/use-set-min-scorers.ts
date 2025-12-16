import { fractalCorePlugin } from "@/lib/plugin";

import { usePluginMutation } from "../use-plugin-mutation";

export const useSetMinScorers = () =>
    usePluginMutation(fractalCorePlugin.adminFractal.setMinScorers, {
        loading: "Setting minimum scorers..",
        success: "Set minimum scorers",
    });
