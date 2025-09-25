import { supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

export const useUnmanagedKeyPair = () =>
    useQuery({
        queryKey: ["generateKeypair"],
        queryFn: async () => {
            const res = await supervisor.functionCall({
                method: "generateKeypair",
                params: [],
                service: "auth-sig",
                intf: "keyvault",
            });

            return z
                .object({ publicKey: z.string(), privateKey: z.string() })
                .parse(res);
        },
    });
