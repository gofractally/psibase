import { wait } from "@/lib/wait";
import { Account } from "@/lib/zod/Account";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Contact } from "../types";
import { ContactsDb } from "../store";
import { getContacts } from "../store";
import QueryKey from "@/lib/queryKeys";
import { addUserToCache } from "./useContacts";
import { AwaitTime } from "@/globals";

export const useCreateContact = (
    username?: z.infer<typeof Account> | null | undefined,
) => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (newContact: Omit<Contact, "id">) => {
            if (!username) throw new Error("Username is required");
            await wait(500);
            const contact = {
                ...newContact,
                id: Math.random().toString(36).substr(2, 9),
            };
            ContactsDb.set(Account.parse(username), [
                ...getContacts(username),
                contact,
            ]);
            return contact;
        },
        onSuccess: (params) => {
            addUserToCache(username!, params);
            // setTimeout(() => {
            // queryClient.invalidateQueries({
            // queryKey: QueryKey.contacts(username!),
            // });
            // }, AwaitTime);
        },
    });
};
