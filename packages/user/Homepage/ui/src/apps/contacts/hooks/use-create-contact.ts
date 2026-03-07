import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { upsertUserToCache } from "@shared/hooks/use-contacts";
import SharedQueryKey from "@shared/lib/query-keys";
import { toast } from "@shared/shadcn/ui/sonner";

import { LocalContact, zLocalContact } from "../types";

export const useCreateContact = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (newContact: LocalContact) => {
            const parsed = zLocalContact.parse(newContact);
            void (await supervisor.functionCall({
                service: zAccount.parse("profiles"),
                method: "set",
                intf: "contacts",
                params: [parsed, false],
            }));
        },
        onMutate: () => ({ toastId: toast.loading("Creating contact...") }),
        onSuccess: (_, newContact, context) => {
            toast.success("Contact created", { id: context.toastId });
            const username = zAccount.parse(
                queryClient.getQueryData(QueryKey.currentUser()),
            );
            upsertUserToCache(username, newContact);
            queryClient.invalidateQueries({
                queryKey: SharedQueryKey.contacts(username),
            });
        },
        onError: (error, _, context) => {
            toast.error(error.message, { id: context?.toastId });
        },
    });
};
