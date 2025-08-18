import { usePluginMutation } from "./use-plugin-mutation";

export const useAcceptStaged = () =>
    usePluginMutation<[number]>(
        {
            intf: "respondent",
            method: "accept",
            service: "staged-tx",
        },
        {
            error: "Failed accepting proposal",
            loading: "Accepting proposal",
            success: "Accepted proposal",
            isStagable: false,
        },
    );
