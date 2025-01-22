import { supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

export const useCurrentAccounts = (enabled: boolean) =>
    useQuery({
        queryKey: ["currentAccounts"],
        enabled,
        initialData: [],
        queryFn: async () => {
            const res = z
                .string()
                .array()
                .parse(
                    await supervisor.functionCall({
                        method: "getConnectedAccounts",
                        params: [],
                        service: "accounts",
                        intf: "activeApp",
                    })
                );

            return res;
        },
    });
    