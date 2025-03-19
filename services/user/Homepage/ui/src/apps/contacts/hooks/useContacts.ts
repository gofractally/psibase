import { Account } from "@/lib/zod/Account";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import QueryKey from "@/lib/queryKeys";
import { queryClient } from "@/main";
import { supervisor } from "@/supervisor";
import { LocalContact } from "../types";

export const useContacts = (
    username?: z.infer<typeof Account> | null | undefined,
) =>
    useQuery({
        queryKey: QueryKey.contacts(username),
        queryFn: async () => {
            const res = await supervisor.functionCall({
                service: Account.parse("profiles"),
                method: "getContacts",
                params: [],
                intf: "api",
            });

            return LocalContact.array().parse(res);
        },
        enabled: !!username,
    });

export const upsertUserToCache = (
    username: z.infer<typeof Account>,
    contact: z.infer<typeof LocalContact>,
) => {
    queryClient.setQueryData(QueryKey.contacts(username), (data: unknown) => {
        if (data) {
            const parsed = LocalContact.array().parse(data);
            const isExisting = parsed.some(
                (c) => c.account === contact.account,
            );

            return isExisting
                ? parsed.map((c) =>
                      c.account === contact.account ? contact : c,
                  )
                : [...parsed, contact];
        }
        return [contact];
    });
};

export const removeUserFromCache = (
    username: z.infer<typeof Account>,
    account: z.infer<typeof Account>,
) => {
    queryClient.setQueryData(QueryKey.contacts(username), (data: unknown) => {
        if (data) {
            const parsed = LocalContact.array().parse(data);
            return parsed.filter((c) => c.account !== account);
        }
        return [];
    });
};
