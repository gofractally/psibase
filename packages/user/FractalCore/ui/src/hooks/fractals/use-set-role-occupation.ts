import { fractalCorePlugin } from "@/lib/plugin";
import QueryKey from "@/lib/query-keys";

import { getSubDomain } from "@shared/lib/get-sub-domain";
import { queryClient } from "@shared/lib/query-client";

import { usePluginFunctionCallMutation } from "../use-plugin-function-call-mutation";

export const useSetRoleOccupation = () =>
    usePluginFunctionCallMutation(fractalCorePlugin.adminFractal.setRoleOccupation, {
        toast: {
            error: "Failed setting role occupation",
            loading: "Setting role occupation",
            success: "Set role occupation",
        },
        onStagedTransaction: (_, status) => {
            if (status.type == "executed") {
                queryClient.invalidateQueries({
                    queryKey: QueryKey.members(getSubDomain()),
                });
            }
        },
    });
