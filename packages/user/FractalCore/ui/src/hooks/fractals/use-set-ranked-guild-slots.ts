import { fractalCorePlugin } from "@/lib/plugin";

import { usePluginMutation } from "../use-plugin-mutation";

export const useSetRankedGuildSlots = () =>
    usePluginMutation(fractalCorePlugin.adminFractal.setRankedGuildSlots, {
        loading: "Setting ranked guild slots..",
        success: "Set ranked guild slots",
    });
