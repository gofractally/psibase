import { Account } from "@/lib/zod/Account";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { supervisor } from "@/supervisor";
import { removeUserFromCache } from "./use-contacts";
import { queryClient } from "@/main";
import QueryKey from "@/lib/queryKeys";
import { toast } from "sonner";

export const useDeleteContact = () =>
    useMutation({
        mutationFn: async (account: z.infer<typeof Account>) => {
            await supervisor.functionCall({
                service: Account.parse("profiles"),
                method: "remove",
                params: [Account.parse(account)],
                intf: "contacts",
            });
        },
        onSuccess: (_, account) => {
            toast.success(`Contact removed: ${account}`);
            const currentUser = Account.parse(
                queryClient.getQueryData(QueryKey.currentUser()),
            );
            removeUserFromCache(currentUser, account);
        },
    });
