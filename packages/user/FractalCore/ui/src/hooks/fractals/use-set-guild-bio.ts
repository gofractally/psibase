import { Account } from "@/lib/zod/Account";

import { usePluginMutation } from "../use-plugin-mutation";
import { useFractalAccount } from "./use-fractal-account";

export const useSetGuildBio = () => {
    const fractal = useFractalAccount();

    return usePluginMutation<[Account, string]>(
        {
            intf: "admin",
            method: "setGuildBio",
            service: fractal,
        },
        {
            error: "Failed setting bio",
            loading: "Setting bio",
            success: "Set bio",
        },
    );
};
