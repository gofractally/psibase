import { usePluginFunctionQuery } from "@shared/hooks/plugin-function/use-plugin-function-query";
import { nameMarket } from "@shared/lib/plugins";

type Options = {
    enabled?: boolean;
};

export const useCanBuyAccount = (options: Options = { enabled: true }) =>
    usePluginFunctionQuery(nameMarket.api.canCreateAccount, [], options);
