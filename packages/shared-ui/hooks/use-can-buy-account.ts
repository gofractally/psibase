import { usePluginFunctionQuery } from "@shared/hooks/plugin-function/use-plugin-function-query";
import { hostingAppCall } from "@shared/lib/plugins/host-app";
import { type PluginCall } from "@shared/lib/plugins/lib/call-plugin-function";

type Options = {
    enabled?: boolean;
    call?: PluginCall<[], boolean>;
};

export const useCanBuyAccount = (options: Options = { enabled: true }) => {
    const { call, ...queryOptions } = options;
    return usePluginFunctionQuery(
        call ?? hostingAppCall<[], boolean>("name-market", "canCreateAccount"),
        [],
        queryOptions,
    );
};
