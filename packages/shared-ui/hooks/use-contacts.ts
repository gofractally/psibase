import type { QueryOptions } from "./types";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { queryClient } from "../lib/query-client";
import QueryKey from "../lib/query-keys";
import { type Account, zAccount } from "../lib/schemas/account";
import { supervisor } from "../lib/supervisor";

export const zLocalContact = z.object({
    account: zAccount,
    nickname: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
});

export const zProcessedContact = zLocalContact.extend({
    avatar: z.string(),
});

export type LocalContact = z.infer<typeof zLocalContact>;
export type ProcessedContact = z.infer<typeof zProcessedContact>;

export const queryContacts = (username: Account | null | undefined) =>
    queryOptions({
        queryKey: QueryKey.contacts(username),
        queryFn: async () => {
            const res = await supervisor.functionCall({
                service: zAccount.parse("profiles"),
                method: "get",
                params: [],
                intf: "contacts",
            });
            return zLocalContact.array().parse(res);
        },
    });

export const useContacts = (
    username?: Account | null | undefined,
    options?: QueryOptions<
        LocalContact[],
        Error,
        LocalContact[],
        ReturnType<typeof QueryKey.contacts>
    >,
) => {
    const queryOptions = options ?? {};
    return useQuery({
        ...queryContacts(username),
        ...queryOptions,
        enabled: !!username && queryOptions.enabled,
    });
};

export const upsertUserToCache = (username: Account, contact: LocalContact) => {
    queryClient.setQueryData(QueryKey.contacts(username), (data: unknown) => {
        if (data) {
            const parsed = zLocalContact.array().parse(data);
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

export const removeUserFromCache = (username: Account, account: Account) => {
    queryClient.setQueryData(QueryKey.contacts(username), (data: unknown) => {
        if (data) {
            const parsed = zLocalContact.array().parse(data);
            return parsed.filter((c) => c.account !== account);
        }
        return [];
    });
};
