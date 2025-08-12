import { useNavigate } from "react-router-dom";

import { getStagedTx } from "@/lib/getStagedTx";

import { usePluginMutation } from "./use-plugin-mutation";

export const useRejectStaged = () => {
    const navigate = useNavigate();

    return usePluginMutation<[number]>(
        {
            intf: "respondent",
            method: "reject",
            service: "staged-tx",
        },
        {
            error: "Failed rejecting proposal",
            loading: "Rejecting proposal",
            success: "Rejected proposal",
            isStagable: false,
            onSuccess: async (args) => {
                const id = args[0];

                const res = (await getStagedTx(id)).details;
                if (!res) {
                    navigate("/pending-transactions");
                }
            },
        },
    );
};
