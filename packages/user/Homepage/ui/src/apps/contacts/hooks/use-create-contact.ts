import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";

import { toast } from "@shared/shadcn/ui/sonner";

import { LocalContact, zLocalContact } from "../types";
import { upsertUserToCache } from "./use-contacts";

export const useCreateContact = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (newContact: LocalContact) => {
            const parsed = zLocalContact.parse(newContact);
            void (await supervisor.functionCall({
                service: Account.parse("profiles"),
                method: "set",
                intf: "contacts",
                params: [parsed, false],
            }));
        },
        onMutate: () => ({ toastId: toast.loading("Creating contact...") }),
        onSuccess: (_, newContact, context) => {
            toast.success("Contact created", { id: context.toastId });
            const username = Account.parse(
                queryClient.getQueryData(QueryKey.currentUser()),
            );
            upsertUserToCache(username, newContact);
            queryClient.invalidateQueries({
                queryKey: QueryKey.contacts(username),
            });
        },
        onError: (error, _, context) => {
            toast.error(error.message, { id: context?.toastId });
        },
    });
};
