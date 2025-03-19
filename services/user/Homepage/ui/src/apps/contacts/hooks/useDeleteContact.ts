import { Account } from "@/lib/zod/Account";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { supervisor } from "@/supervisor";
import { removeUserFromCache } from "./useContacts";
import { queryClient } from "@/main";
import QueryKey from "@/lib/queryKeys";
import { toast } from "sonner";

export const useDeleteContact = () =>
    useMutation({
        mutationFn: async (account: z.infer<typeof Account>) => {
            await supervisor.functionCall({
                service: Account.parse("profiles"),
                method: "removeContact",
                params: [Account.parse(account)],
                intf: "api",
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
