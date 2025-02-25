import { supervisor } from "@/supervisor";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

export const useCurrentAccounts = () =>
    useQuery({
        queryKey: ["currentAccounts"],
        queryFn: async () => {
            return z
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

        },
    });