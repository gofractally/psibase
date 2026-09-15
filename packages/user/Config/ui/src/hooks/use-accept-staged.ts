import { usePluginMutation } from "./use-plugin-mutation";

export const useAcceptStaged = () =>
    usePluginMutation<[number]>(
        {
            intf: "staged",
            method: "accept",
            service: "config",
        },
        {
            error: "Failed accepting proposal",
            loading: "Accepting proposal",
            success: "Accepted proposal",
            isStagable: false,
        },
    );
