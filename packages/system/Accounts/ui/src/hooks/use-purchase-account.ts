import { type MutationOptions } from "@shared/hooks/plugin-function";
import { usePluginFunctionMutation } from "@shared/hooks/plugin-function/use-plugin-function-mutation";
import { accounts } from "@shared/lib/plugins";

export const usePurchaseAccount = (
    options: MutationOptions<[string, string], string> = {},
) => usePluginFunctionMutation(accounts.prompt.purchaseAccount, options);
