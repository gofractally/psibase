import { queryClient } from "@/queryClient";

import { fractalCorePlugin } from "@/lib/plugin";
import QueryKey from "@/lib/queryKeys";

import { getSubDomain } from "@shared/lib/get-sub-domain";

import { usePluginFunctionCallMutation } from "../use-plugin-function-call-mutation";

export const useExile = () =>
    usePluginFunctionCallMutation(fractalCorePlugin.adminFractal.exileMember, {
        toast: {
            error: "Failed exile",
            loading: "Exiling member",
            success: "Exiled member",
        },
        onStagedTransaction: (_, status) => {
            if (status.type == "executed") {
                queryClient.invalidateQueries({
                    queryKey: QueryKey.members(getSubDomain()),
                });
            }
        },
    });
