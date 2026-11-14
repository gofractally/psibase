import { fractalCorePlugin } from "@/lib/plugin";
import QueryKey from "@/lib/query-keys";

import { getSubDomain } from "@shared/lib/get-sub-domain";
import { queryClient } from "@shared/lib/query-client";

import { usePluginFunctionCallMutation } from "../use-plugin-function-call-mutation";

const onDone = (_: unknown, status: { type: string }) => {
    if (status.type == "executed") {
        queryClient.invalidateQueries({
            queryKey: QueryKey.levies(getSubDomain()),
        });
    }
};

export const useAddLevy = () =>
    usePluginFunctionCallMutation(fractalCorePlugin.adminFractal.addLevy, {
        toast: {
            error: "Failed to post levy",
            loading: "Posting levy",
            success: "Levy posted",
        },
        onStagedTransaction: onDone,
    });

export const useRemoveLevy = () =>
    usePluginFunctionCallMutation(fractalCorePlugin.adminFractal.rmLevy, {
        toast: {
            error: "Failed to remove levy",
            loading: "Removing levy",
            success: "Levy removed",
        },
        onStagedTransaction: onDone,
    });
