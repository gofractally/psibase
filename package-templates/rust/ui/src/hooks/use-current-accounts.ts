import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "src/main";

export const useCurrentAccounts = (enabled = true) =>
    useQuery({
        queryKey: ["currentAccounts"],
        enabled,
        initialData: [],
        queryFn: async () => {
            const connectedAccounts = await supervisor.functionCall({
                method: "getConnectedAccounts",
                params: [],
                service: "accounts",
                intf: "activeApp",
            });
            const res = z.string().array().parse(connectedAccounts);
            return res;
        },
    });