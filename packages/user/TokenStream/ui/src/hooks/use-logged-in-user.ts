import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/queryKeys";

import { supervisor } from "@shared/lib/supervisor";

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
            if (res) {
                return z.string().parse(res);
            } else {
                return null;
            }
        },
    });
