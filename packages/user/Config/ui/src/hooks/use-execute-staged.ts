import { useNavigate } from "react-router-dom";

import { usePluginMutation } from "./use-plugin-mutation";

export const useExecuteStaged = () => {
    const navigate = useNavigate();

    return usePluginMutation<[number]>(
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
            onSuccess: () => {
                navigate("/pending-transactions");
            },
        },
    );
};
