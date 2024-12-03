import { queryClient, supervisor } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

export const useSelectAccount = () =>
    useMutation({
        mutationKey: ["selectAccount"],
        mutationFn: async (accountName: string) =>
            supervisor.functionCall({
                method: "login",
                params: [z.string().parse(accountName)],
                service: "accounts",
                intf: "activeApp",
            }),
        onSuccess: () => {
            queryClient.refetchQueries({ queryKey: ["loggedInUser"] });
            setTimeout(() => {
                queryClient.refetchQueries({ queryKey: ["loggedInUser"] });
            }, 2000);
        },
    });
