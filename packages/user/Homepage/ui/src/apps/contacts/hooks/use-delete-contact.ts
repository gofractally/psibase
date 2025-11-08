import { queryClient } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { toast } from "@shared/shadcn/ui/sonner";

import { removeUserFromCache } from "./use-contacts";

export const useDeleteContact = () =>
    useMutation({
        mutationFn: async (account: z.infer<typeof zAccount>) => {
            await supervisor.functionCall({
                service: zAccount.parse("profiles"),
                method: "remove",
                params: [zAccount.parse(account)],
                intf: "contacts",
            });
        },
        onSuccess: (_, account) => {
            toast.success(`Contact removed: ${account}`);
            const currentUser = zAccount.parse(
                queryClient.getQueryData(QueryKey.currentUser()),
            );
            removeUserFromCache(currentUser, account);
        },
    });
