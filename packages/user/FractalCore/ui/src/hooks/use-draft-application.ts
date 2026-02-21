import { fractalCorePlugin } from "@/lib/plugin";
import { usePluginMutation } from "./use-plugin-mutation";

export const useDraftApplication = () => usePluginMutation(fractalCorePlugin.userGuild.draftApplication, {
    isStagable: false,
});
