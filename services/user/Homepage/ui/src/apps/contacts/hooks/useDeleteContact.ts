import { Account } from "@/lib/zod/Account";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { wait } from "@/lib/wait";
import { ContactsDb } from "../store";
import { getContacts } from "../store";

export const useDeleteContact = (loggedInUser?: z.infer<typeof Account>) => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (username: z.infer<typeof Account>) => {
            if (!loggedInUser) {
                throw new Error("Logged in user not found");
            }
            await wait(500);
            ContactsDb.set(
                loggedInUser,
                getContacts(username).filter((c) => c.account !== username),
            );
            return true;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["contacts"] });
        },
    });
};
