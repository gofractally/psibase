import { supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { AuthServices } from "../types";

export const useUnmanagedKeyPair = () =>
    useQuery({
        queryKey: ["generateKeypair"],
        queryFn: async () => {
            const res = await supervisor.functionCall({
                method: "generateKeypair",
                params: [],
                service: AuthServices.AUTH_SIG,
                intf: "keyvault",
            });

            return z
                .object({ publicKey: z.string(), privateKey: z.string() })
                .parse(res);
        },
    });
