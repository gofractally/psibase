import { useQuery } from "@tanstack/react-query";
import { supervisor } from "src/main";
import { z } from "zod";

export const useLoggedInUser = (enabled = true) =>
    useQuery({
        queryKey: ["loggedInUser"],
        enabled,
        initialData: null,
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
