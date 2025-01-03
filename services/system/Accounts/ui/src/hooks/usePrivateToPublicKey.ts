import { supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

export const usePrivateToPublicKey = (key: string) =>
  useQuery<string>({
    queryKey: ["privateToPublicKey", key],
    enabled: !!key,
    queryFn: async () => {
      const res = await supervisor.functionCall({
        method: "pubFromPriv",
        params: [key],
        service: "auth-sig",
        intf: "keyvault",
      });


      return z.string().parse(res);
    },
  });
