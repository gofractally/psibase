import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { toast } from "@shared/shadcn/ui/sonner";

import { LocalContact } from "../types";

export const useUpdateContact = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (updatedContact: LocalContact) => {
            void (await supervisor.functionCall({
                service: zAccount.parse("profiles"),
                method: "set",
                params: [updatedContact],
                intf: "contacts",
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
                    queryKey: QueryKey.contacts(zAccount.parse(currentUser)),
                });
            }
        },
    });
};
