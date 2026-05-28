import { usePluginFunctionQuery } from "@shared/hooks/plugin-function/use-plugin-function-query";
import { accounts } from "@shared/lib/plugins";

type Options = {
    enabled?: boolean;
};

export const useCanCreatePremiumAccount = (
    options: Options = { enabled: true },
) =>
    usePluginFunctionQuery(
        accounts.prompt.canCreatePremiumAccount,
        [],
        options,
    );
