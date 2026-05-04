import { useMutation } from "@tanstack/react-query";

import { upsertUserToCache } from "@shared/hooks/use-contacts";
import SharedQueryKey from "@shared/lib/query-keys";
import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

import { LocalContact, zLocalContact } from "../types";

export const useCreateContact = () => {
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
        onSuccess: (_data, newContact, onMutateResult, context) => {
            toast.success("Contact created", { id: onMutateResult.toastId });
            const username = zAccount.parse(
                context.client.getQueryData(SharedQueryKey.currentUser()),
            );
            upsertUserToCache(username, newContact);
            context.client.invalidateQueries({
                queryKey: SharedQueryKey.contacts(username),
            });
        },
        onError: (error, _, onMutateResult) => {
            toast.error(error.message, { id: onMutateResult?.toastId });
        },
    });
};
