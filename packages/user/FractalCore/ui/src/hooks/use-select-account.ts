import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";

import QueryKey from "@/lib/queryKeys";

import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

export const useSelectAccount = () =>
    useMutation<void, Error, string>({
        mutationKey: QueryKey.selectAccount(),
        mutationFn: async (accountName: string) => {
            void (await supervisor.functionCall({
                method: "login",
                params: [zAccount.parse(accountName)],
                service: "accounts",
                intf: "activeApp",
            }));
        },
        onSuccess: (_, accountName) => {
            queryClient.setQueryData(QueryKey.currentUser(), () => accountName);
        },
        onError: (error) => {
            if (error instanceof Error) {
                toast.error(error.message);
            } else {
                toast.error("Unrecognised error, please see log");
                console.error(error);
            }
        },
    });
