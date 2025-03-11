import { Account } from "@/lib/zod/Account";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Contact } from "../types";
import { wait } from "@/lib/wait";
import { ContactsDb } from "../store";
import { getContacts } from "../store";

export const useUpdateContact = (username?: z.infer<typeof Account>) => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (updatedContact: Contact) => {
            await wait(500);
            const index = getContacts(username).findIndex(
                (c) => c.account === updatedContact.account,
            );
            if (index !== -1) {
                ContactsDb.set(Account.parse(username), [
                    ...getContacts(username),
                    updatedContact,
                ]);
                return updatedContact;
            }
            throw new Error("Contact not found");
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["contacts"] });
        },
    });
};
