import { Account } from "@/lib/zod/Account";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ContactSchema } from "../types";
import { wait } from "@/lib/wait";
import { getContacts } from "../store";
import QueryKey from "@/lib/queryKeys";
import { queryClient } from "@/main";

export const useContacts = (
    username?: z.infer<typeof Account> | null | undefined,
) =>
    useQuery<z.infer<typeof ContactSchema>[]>({
        queryKey: QueryKey.contacts(username),
        queryFn: async () => {
            await wait(500);
            return ContactSchema.array().parse(getContacts(username));
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
