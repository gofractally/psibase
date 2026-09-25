import { usePluginFunctionQuery } from "@shared/hooks/plugin-function/use-plugin-function-query";
import { hostingAppCall } from "@shared/lib/plugins/host-app";

type Options = {
    enabled?: boolean;
};

export const useHasProfilesReadPermission = (
    { enabled }: Options = { enabled: true },
) => {
    return usePluginFunctionQuery(
        hostingAppCall<[], boolean>("contacts", "hasReadPermission"),
        [],
        {
            enabled,
        },
    );
};
