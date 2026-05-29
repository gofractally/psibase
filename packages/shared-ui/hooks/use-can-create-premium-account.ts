import { usePluginFunctionQuery } from "@shared/hooks/plugin-function/use-plugin-function-query";
import { premAccounts } from "@shared/lib/plugins";

type Options = {
    enabled?: boolean;
};

export const useCanCreatePremiumAccount = (
    options: Options = { enabled: true },
) =>
    usePluginFunctionQuery(
        premAccounts.api.canCreatePremiumAccount,
        [],
        options,
    );
