import { supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { AuthServices } from "../types";

export const usePrivateToPublicKey = (key: string) =>
    useQuery<string>({
        queryKey: ["privateToPublicKey", key],
        enabled: !!key,
        queryFn: async () => {
            const res = z.string().parse(
                await supervisor.functionCall({
                    method: "pubFromPriv",
                    params: [key],
                    service: AuthServices.AUTH_SIG,
                    intf: "keyvault",
                }),
            );

            return res.replace(/\n/g, " ");
        },
    });
