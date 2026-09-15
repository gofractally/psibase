import type { QueryOptions } from "./types";
import type { AutoRedirectConfig } from "@psibase/common-lib";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { queryClient } from "../lib/query-client";
import QueryKey from "../lib/query-keys";
import { type Account, zAccount } from "../lib/schemas/account";
import { supervisor } from "../lib/supervisor";
import { type PluginCall } from "../lib/plugins/lib/call-plugin-function";

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

export type ContactsGetCall = PluginCall<[], unknown>;

export type ContactsQueryKey = readonly [
    ...ReturnType<typeof QueryKey.contacts>,
    Account,
];

export const queryContacts = (
    getCall: ContactsGetCall,
    username: Account | null | undefined,
    autoRedirectConfig: AutoRedirectConfig,
) =>
    queryOptions({
        queryKey: [
            ...QueryKey.contacts(username),
            getCall.service,
        ] as ContactsQueryKey,
        queryFn: async () => {
            const res = await supervisor.functionCall(
                {
                    service: getCall.service,
                    method: getCall.method,
                    params: [],
                    intf: getCall.intf,
                },
                autoRedirectConfig,
            );
            return zLocalContact.array().parse(res);
        },
    });

export const useContacts = (
    getCall: ContactsGetCall,
    username?: Account | null | undefined,
    options?: QueryOptions<
        LocalContact[],
        Error,
        LocalContact[],
        ContactsQueryKey
    >,
    autoRedirectConfig: AutoRedirectConfig = {
        enabled: true,
        returnPath: "/",
    },
) => {
    const queryOptions = options ?? {};
    return useQuery({
        ...queryContacts(getCall, username, autoRedirectConfig),
        ...queryOptions,
        enabled: !!username && queryOptions.enabled,
    });
};

export const upsertUserToCache = (
    username: Account,
    contact: LocalContact,
    service: Account,
) => {
    queryClient.setQueryData(
        [...QueryKey.contacts(username), service],
        (data: unknown) => {
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
        },
    );
};

export const removeUserFromCache = (
    username: Account,
    account: Account,
    service: Account,
) => {
    queryClient.setQueryData(
        [...QueryKey.contacts(username), service],
        (data: unknown) => {
            if (data) {
                const parsed = zLocalContact.array().parse(data);
                return parsed.filter((c) => c.account !== account);
            }
            return [];
        },
    );
};
