import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/queryKeys";

import { supervisor } from "@shared/lib/supervisor";

export const useConnectedAccounts = () =>
    useQuery({
        queryKey: QueryKey.connectedAccounts(),
        initialData: [],
        queryFn: async () => {
            try {
                return z
                    .string()
                    .array()
                    .parse(
                        await supervisor.functionCall({
                            method: "getConnectedAccounts",
                            params: [],
                            service: "accounts",
                            intf: "activeApp",
                        }),
                    );
            } catch (error) {
                const message = "Error getting connected accounts";
                console.error(message, error);
                throw error;
            }
        },
    });
