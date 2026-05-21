import { useQuery } from "@tanstack/react-query";
import { useDebounceValue } from "usehooks-ts";

import QueryKey from "@/lib/query-keys";

import { isAccountAvailable } from "@shared/lib/get-account";
import { zAccount } from "@shared/lib/schemas/account";

export type AccountAvailability =
    | "invalid"
    | "taken"
    | "available"
    | "idle";

export const useAccountAvailability = (accountName: string) => {
    const [debouncedName] = useDebounceValue(accountName.trim(), 500);

    return useQuery({
        queryKey: QueryKey.premAccountAvailability(debouncedName),
        queryFn: async (): Promise<Exclude<AccountAvailability, "idle">> => {
            const parsed = zAccount.safeParse(debouncedName);
            if (!parsed.success) {
                return "invalid";
            }

            const status = await isAccountAvailable(debouncedName);
            return status === "Taken" ? "taken" : "available";
        },
        enabled: debouncedName.length > 0,
    });
};
