import { fractalCorePlugin } from "@/lib/plugin";
import QueryKey from "@/lib/query-keys";

import { getSubDomain } from "@shared/lib/get-sub-domain";
import { queryClient } from "@shared/lib/query-client";

import { usePluginMutation } from "../use-plugin-mutation";

export const useApplyReturn = () =>
    usePluginMutation(fractalCorePlugin.userFractal.applyReturn, {
        isStagable: false,
        loading: "Applying to return",
        error: "Failed applying to return",
        success: "Applied to return",
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: QueryKey.returnApplications(getSubDomain()),
            });
        },
    });
