import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";

import { LocalContact } from "../types";

export const useUpdateContact = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (updatedContact: LocalContact) => {
            void (await supervisor.functionCall({
                service: Account.parse("profiles"),
                method: "updateContact",
                params: [updatedContact],
                intf: "api",
            }));
        },
        onError: (error) => {
            toast.error(`Error updating contact: ${error.message}`);
        },
        onSuccess: () => {
            const currentUser = queryClient.getQueryData(
                QueryKey.currentUser(),
            );
            if (currentUser) {
                queryClient.invalidateQueries({
                    queryKey: QueryKey.contacts(Account.parse(currentUser)),
                });
            }
        },
    });
};
