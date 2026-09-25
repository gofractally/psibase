import { usePluginFunctionQuery } from "@shared/hooks/plugin-function/use-plugin-function-query";
import { hostingAppCall } from "@shared/lib/plugins/host-app";

type Options = {
    enabled?: boolean;
};

export const useCanBuyAccount = (options: Options = { enabled: true }) =>
    usePluginFunctionQuery(
        hostingAppCall<[], boolean>("name-market", "canCreateAccount"),
        [],
        options,
    );
