import { fractalCorePlugin } from "@/lib/plugin";
import QueryKey from "@/lib/query-keys";

import { getSubDomain } from "@shared/lib/get-sub-domain";
import { queryClient } from "@shared/lib/query-client";

import { usePluginFunctionCallMutation } from "../use-plugin-function-call-mutation";

export const useExile = (ending = false) =>
    usePluginFunctionCallMutation(fractalCorePlugin.adminFractal.exileMember, {
        toast: ending
            ? {
                  error: "Failed to end exile",
                  loading: "Ending exile",
                  success: "Exile ended",
              }
            : {
                  error: "Failed exile",
                  loading: "Exiling member",
                  success: "Exiled member",
              },
        onStagedTransaction: (_, status) => {
            if (status.type == "executed") {
                queryClient.invalidateQueries({
                    queryKey: QueryKey.members(getSubDomain()),
                });
                queryClient.invalidateQueries({
                    queryKey: QueryKey.exiles(getSubDomain()),
                });
            }
        },
    });
