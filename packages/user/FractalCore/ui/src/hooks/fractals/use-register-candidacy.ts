import { fractalCorePlugin } from "@/lib/plugin";

import { usePluginMutation } from "../use-plugin-mutation";

export const useRegisterCandidacy = () =>
    usePluginMutation(fractalCorePlugin.userGuild.registerCandidacy, {
        loading: "Saving candidacy..",
        success: "Saved candidacy",
        isStagable: false,
    });
