import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import { Account } from "@/lib/zodTypes";

import { toast } from "@shared/shadcn/ui/sonner";

import { useLogout } from "./useLogout";

export const useSelectAccount = () => {
    const { mutateAsync: logout } = useLogout();
    return useMutation<void, Error, string>({
        mutationKey: ["selectAccount"],
        mutationFn: async (accountName: string) => {
            try {
                await supervisor.functionCall({
                    method: "login",
                    params: [Account.parse(accountName)],
                    service: "accounts",
                    intf: "activeApp",
                });
            } catch (error) {
                console.error("❌ Authenticated login failed:", error);
                // Ensure clean state on any failure
                await logout();
                throw error;
            }
        },
        onSuccess: (_, accountName) => {
            queryClient.setQueryData(["loggedInUser"], () => accountName);
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
};
