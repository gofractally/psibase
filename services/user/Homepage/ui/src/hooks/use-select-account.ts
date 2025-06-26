import { queryClient } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@shared/shadcn/ui/sonner";

import { supervisor } from "@/supervisor";

import { AwaitTime } from "@/globals";
import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";

import { setCurrentUser } from "./use-current-user";

export const useSelectAccount = () =>
    useMutation<void, Error, string>({
        mutationKey: ["selectAccount"],
        mutationFn: async (accountName: string) => {
            void (await supervisor.functionCall({
                method: "login",
                params: [Account.parse(accountName)],
                service: "accounts",
                intf: "activeApp",
            }));
        },
        onSuccess: (_, accountName) => {
            setCurrentUser(accountName);
            setTimeout(() => {
                queryClient.refetchQueries({
                    queryKey: QueryKey.currentUser(),
                });
            }, AwaitTime);
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
