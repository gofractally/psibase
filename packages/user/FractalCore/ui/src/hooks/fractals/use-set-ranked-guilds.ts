import { fractalCorePlugin } from "@/lib/plugin";

import { usePluginMutation } from "../use-plugin-mutation";

export const useSetRankedGuilds = () =>
    usePluginMutation(fractalCorePlugin.adminFractal.setRankedGuilds, {
        loading: "Setting ranked guilds..",
        success: "Set ranked guilds",
    });
