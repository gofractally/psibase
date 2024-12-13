import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "src/main";

export const useLoggedInUser = (enabled = true) =>
    useQuery({
        queryKey: ["loggedInUser"],
        enabled,
        initialData: null,
        queryFn: async () => {
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
