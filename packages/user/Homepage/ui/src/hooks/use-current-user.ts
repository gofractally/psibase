import { useQuery } from "@tanstack/react-query";

import QueryKey from "@shared/lib/query-keys";
import { zAccount } from "@shared/lib/schemas/account";

import { supervisor } from "@/supervisor";

/**
 * Homepage-specific current user hook that uses this app's supervisor
 * (with correct supervisorSrc). Uses the shared query key so cache is
 * consistent with other apps.
 */
export const useCurrentUser = () =>
    useQuery({
        queryKey: QueryKey.currentUser(),
        queryFn: async () => {
            const res = await supervisor.functionCall({
                method: "getCurrentUser",
                params: [],
                service: "accounts",
                intf: "api",
            });
            return res ? zAccount.parse(res) : null;
        },
        staleTime: 60000,
    });
