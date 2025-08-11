import { usePluginMutation } from "./use-plugin-mutation";

export const useExecuteStaged = () =>
    usePluginMutation<[number]>(
        {
            intf: "respondent",
            method: "execute",
            service: "staged-tx",
        },
        {
            error: "Failed executing proposal",
            loading: "Executing proposal",
            success: "Executed proposal",
            isStagable: false,
        },
    );
