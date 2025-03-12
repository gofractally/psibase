import { Account } from "@/lib/zod/Account";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ContactSchema } from "../types";
import { wait } from "@/lib/wait";
import { getContacts } from "../store";
import QueryKey from "@/lib/queryKeys";
import { queryClient } from "@/main";
import { randPhoneNumber } from "@ngneat/falso";
import { randEmail } from "@ngneat/falso";
import { randCompanyName } from "@ngneat/falso";
import { randJobTitle, randUserName } from "@ngneat/falso";
import { randFullName } from "@ngneat/falso";
import { randAvatar } from "@ngneat/falso";
import { Contact } from "../components/contact-details";

const contacts = Array.from({ length: 30 }, () => ({
    account: randUserName(),
    displayName: randFullName(),
    jobTitle: randJobTitle(),
    company: randCompanyName(),
    avatarUrl: Math.random() > 0.5 ? randAvatar() : undefined,
    email: randEmail(),
    phone: randPhoneNumber(),
}));

export const useContacts = (
    username?: z.infer<typeof Account> | null | undefined,
) =>
    useQuery<Contact[]>({
        queryKey: QueryKey.contacts(username),
        queryFn: async () => {
            await wait(500);
            return contacts;
        },
        enabled: !!username,
    });

export const addUserToCache = (
    username: z.infer<typeof Account>,
    contact: z.infer<typeof ContactSchema>,
) => {
    queryClient.setQueryData(QueryKey.contacts(username), [
        ...getContacts(username),
        contact,
    ]);
};
