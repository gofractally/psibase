import { queryClient, supervisor } from "@/main";
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
                queryClient
                    .fetchQuery({ queryKey: ["loggedInUser"] })
                    .then((x) =>
                        console.log(x, "came back get logged in user")
                    );
            }, 2500);
        },
    });
