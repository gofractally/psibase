import { queryClient } from "@/main";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";

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
            queryClient.refetchQueries({ queryKey: ["loggedInUser"] });
            setTimeout(() => {
                queryClient.refetchQueries({ queryKey: ["loggedInUser"] });
            }, 2500);
        },
    });
