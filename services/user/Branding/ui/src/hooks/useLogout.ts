import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import { useExpectCurrentUser } from "./useExpectCurrentUser";

export const useLogout = () => {
    const queryClient = useQueryClient();
    const [, setExpectCurrentUser] = useExpectCurrentUser();

    return useMutation({
        mutationKey: ["logout"],
        mutationFn: async () => {
            void (await supervisor.functionCall({
                method: "logout",
                params: [],
                service: "accounts",
                intf: "activeApp",
            }));
        },
        onSuccess: () => {
            setExpectCurrentUser(false);
            queryClient.setQueryData(["loggedInUser"], null);
        },
    });
};
