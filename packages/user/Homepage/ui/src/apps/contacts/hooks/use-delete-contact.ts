import { useMutation } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";

import { removeUserFromCache } from "@shared/hooks/use-contacts";
import { type Account, zAccount } from "@shared/lib/schemas/account";
import { toast } from "@shared/shadcn/ui/sonner";

export const useDeleteContact = () =>
    useMutation({
        mutationFn: async (account: Account) => {
            await supervisor.functionCall({
                service: zAccount.parse("profiles"),
                method: "remove",
                params: [zAccount.parse(account)],
                intf: "contacts",
            });
        },
        onSuccess: (_data, account, _onMutateResult, context) => {
            toast.success(`Contact removed: ${account}`);
            const currentUser = zAccount.parse(
                context.client.getQueryData(QueryKey.currentUser()),
            );
            removeUserFromCache(currentUser, account);
        },
    });
