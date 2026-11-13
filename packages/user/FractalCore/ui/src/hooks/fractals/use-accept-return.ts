import { fractalCorePlugin } from "@/lib/plugin";
import QueryKey from "@/lib/query-keys";

import { getSubDomain } from "@shared/lib/get-sub-domain";
import { queryClient } from "@shared/lib/query-client";

import { usePluginFunctionCallMutation } from "../use-plugin-function-call-mutation";

export const useAcceptReturn = () =>
    usePluginFunctionCallMutation(fractalCorePlugin.adminFractal.acceptReturn, {
        toast: {
            error: "Failed to accept return",
            loading: "Accepting return",
            success: "Return accepted",
        },
        onStagedTransaction: (_, status) => {
            if (status.type == "executed") {
                queryClient.invalidateQueries({
                    queryKey: QueryKey.returnApplications(getSubDomain()),
                });
                queryClient.invalidateQueries({
                    queryKey: QueryKey.members(getSubDomain()),
                });
            }
        },
    });
