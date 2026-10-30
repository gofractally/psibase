import { useNavigate } from "react-router-dom";

import { usePluginMutation } from "./use-plugin-mutation";

export const useRemoveStaged = () => {
    const navigate = useNavigate();
    return usePluginMutation<[number]>(
        {
            intf: "staged",
            method: "remove",
            service: "config",
        },
        {
            error: "Failed removing proposal",
            loading: "Removing proposal",
            success: "Removed proposal",
            isStagable: false,
            onSuccess: async () => {
                navigate("/pending-transactions");
            },
        },
    );
};
