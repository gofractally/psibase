import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@lib/supervisor";

export const useLoggedInUser = (enabled: boolean) =>
    useQuery({
        queryKey: ["loggedInUser"],
        enabled,
        initialData: null,
        queryFn: async () => {
            const supervisor = await getSupervisor();
            const res = await supervisor.functionCall({
                method: "getLoggedInUser",
                params: [],
                service: "accounts",
                intf: "activeApp",
            });
            if (res) {
                return z.string().parse(res);
            } else {
                return null;
            }
        },
    });
