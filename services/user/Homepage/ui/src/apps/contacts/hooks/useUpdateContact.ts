import { Account } from "@/lib/zod/Account";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LocalContactType } from "../types";

import { supervisor } from "@/supervisor";
import QueryKey from "@/lib/queryKeys";
import { toast } from "sonner";

export const useUpdateContact = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (updatedContact: LocalContactType) => {
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
