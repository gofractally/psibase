import { fractalCorePlugin } from "@/lib/plugin";
import { usePluginMutation } from "./use-plugin-mutation";

export const usePushApplication = (onSuccess?: () => void) => usePluginMutation(fractalCorePlugin.userGuild.pushApplication, {
    isStagable: false,
    onSuccess: () => {
        if (onSuccess) {
            onSuccess()
        }
    }
});
