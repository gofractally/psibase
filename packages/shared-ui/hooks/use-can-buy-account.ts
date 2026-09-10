import { usePluginFunctionQuery } from "@shared/hooks/plugin-function/use-plugin-function-query";
import { type PluginCall } from "@shared/lib/plugins/lib/call-plugin-function";

type Options = {
    enabled?: boolean;
};

export type CanCreateAccountCall = PluginCall<[], unknown>;

export const useCanBuyAccount = (
    canCreateAccount: CanCreateAccountCall,
    options: Options = { enabled: true },
) => usePluginFunctionQuery(canCreateAccount, [], options);
