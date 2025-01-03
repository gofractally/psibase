import { useQueryClient, useMutation } from "@tanstack/react-query";

import { supervisor } from "src/main";

export const useLogout = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationKey: ["logout"],
        mutationFn: async () => {
            return supervisor.functionCall({
                method: "logout",
                params: [],
                service: "accounts",
                intf: "activeApp",
            });
        },
        onSuccess: () => {
            queryClient.refetchQueries({ queryKey: ["loggedInUser"] });
            setTimeout(() => {
                queryClient.refetchQueries({ queryKey: ["loggedInUser"] });
            }, 2500);
        },
    });
};
