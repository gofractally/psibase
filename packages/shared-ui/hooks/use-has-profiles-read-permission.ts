import { usePluginFunctionQuery } from "@shared/hooks/plugin-function/use-plugin-function-query";
import { type PluginCall } from "@shared/lib/plugins/lib/call-plugin-function";

type Options = {
    enabled?: boolean;
};

export type HasReadPermissionCall = PluginCall<[], unknown>;

export const useHasProfilesReadPermission = (
    hasReadPermission: HasReadPermissionCall,
    { enabled }: Options = { enabled: true },
) => {
    return usePluginFunctionQuery(hasReadPermission, [], {
        enabled,
    });
};
