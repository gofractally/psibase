import { usePluginFunctionQuery } from "@shared/hooks/plugin-function/use-plugin-function-query";
import { hostingAppCall } from "@shared/lib/plugins/host-app";
import { type PluginCall } from "@shared/lib/plugins/lib/call-plugin-function";

type Options = {
    enabled?: boolean;
    call?: PluginCall<[], boolean>;
};

export const useHasProfilesReadPermission = (
    { enabled, call }: Options = { enabled: true },
) => {
    return usePluginFunctionQuery(
        call ?? hostingAppCall<[], boolean>("contacts", "hasReadPermission"),
        [],
        {
            enabled,
        },
    );
};
