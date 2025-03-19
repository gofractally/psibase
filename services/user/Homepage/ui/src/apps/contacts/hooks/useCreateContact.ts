import { Account } from "@/lib/zod/Account";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { LocalContactType } from "../types";
import QueryKey from "@/lib/queryKeys";
import { upsertUserToCache } from "./useContacts";
import { AwaitTime } from "@/globals";
import { supervisor } from "@/supervisor";

export const useCreateContact = (
    username?: z.infer<typeof Account> | null | undefined,
) => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (newContact: LocalContactType) => {
            if (!username) throw new Error("Username is required");
            void (await supervisor.functionCall({
                service: Account.parse("profiles"),
                method: "addContact",
                intf: "api",
                params: [newContact],
            }));
        },
        onSuccess: (_, newContact) => {
            upsertUserToCache(username!, newContact);
            setTimeout(() => {
                queryClient.invalidateQueries({
                    queryKey: QueryKey.contacts(username!),
                });
            }, AwaitTime);
        },
    });
};
