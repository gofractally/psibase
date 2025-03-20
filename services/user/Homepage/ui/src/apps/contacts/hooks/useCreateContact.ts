import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { AwaitTime } from "@/globals";
import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";

import { LocalContact, LocalContactType } from "../types";
import { upsertUserToCache } from "./useContacts";

export const useCreateContact = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (newContact: LocalContactType) => {
            const parsed = LocalContact.parse(newContact);
            let toastId = toast.loading("Creating contact...");
            void (await supervisor.functionCall({
                service: Account.parse("profiles"),
                method: "addContact",
                intf: "api",
                params: [parsed],
            }));
            toast.dismiss(toastId);
        },
        onSuccess: (_, newContact) => {
            const username = Account.parse(
                queryClient.getQueryData(QueryKey.currentUser()),
            );
            upsertUserToCache(username, newContact);
            setTimeout(() => {
                queryClient.invalidateQueries({
                    queryKey: QueryKey.contacts(username),
                });
            }, AwaitTime);
            toast.success("Contact created");
        },
        onError: (error) => {
            toast.error(`Failed to create contact ${error.message}`);
        },
    });
};
