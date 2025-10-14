import { Account } from "@/lib/zod/Account";

import { usePluginMutation } from "../use-plugin-mutation";
import { useFractalAccount } from "./use-fractal-account";

export const useSetGuildDescription = () => {
    const fractal = useFractalAccount();

    return usePluginMutation<[Account, string]>(
        {
            intf: "adminGuild",
            method: "setDescription",
            service: fractal,
        },
        {
            error: "Failed setting description",
            loading: "Setting description",
            success: "Set description.",
        },
    );
};
