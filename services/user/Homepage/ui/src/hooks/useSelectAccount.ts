import { AwaitTime } from "@/globals";
import { queryClient } from "@/main";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { currentUserQueryKey, setCurrentUser } from "./useCurrentUser";
import { Account } from "@/lib/zod/Account";

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
            setCurrentUser(accountName)
            setTimeout(() => {
                queryClient.refetchQueries({ queryKey: currentUserQueryKey });
            }, AwaitTime);
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
