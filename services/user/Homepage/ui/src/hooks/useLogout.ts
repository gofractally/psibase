import { queryClient } from "@/main";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { setCurrentUser, currentUserQueryKey } from "./useCurrentUser";
import { AwaitTime } from "@/globals";

export const useLogout = () =>
    useMutation({
        mutationKey: ["logout"],
        mutationFn: async () =>
            supervisor.functionCall({
                method: "logout",
                params: [],
                service: "accounts",
                intf: "activeApp",
            }),
        onSuccess: () => {
            setCurrentUser(null)
            setTimeout(() => {
                queryClient.refetchQueries({ queryKey: currentUserQueryKey });
            }, AwaitTime);
        },
    });
