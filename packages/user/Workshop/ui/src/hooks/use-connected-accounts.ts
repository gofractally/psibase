import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

export const useConnectedAccounts = () =>
    useQuery({
        queryKey: ["connectedAccounts"],
        initialData: [],
        queryFn: async () =>
            z
                .string()
                .array()
                .parse(
                    await supervisor.functionCall({
                        method: "getConnectedAccounts",
                        params: [],
                        service: "accounts",
                        intf: "activeApp",
                    }),
                ),
    });
