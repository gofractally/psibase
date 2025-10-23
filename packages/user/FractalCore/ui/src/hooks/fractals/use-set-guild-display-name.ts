import { Account } from "@/lib/zod/Account";

import { usePluginMutation } from "../use-plugin-mutation";
import { useFractalAccount } from "./use-fractal-account";

export const useSetGuildDisplayName = () => {
    const fractal = useFractalAccount();

    return usePluginMutation<[Account, string]>(
        {
            intf: "adminGuild",
            method: "setDisplayName",
            service: fractal,
        },
        {
            error: "Failed setting display name",
            loading: "Setting display name",
            success: "Set display name",
        },
    );
};
