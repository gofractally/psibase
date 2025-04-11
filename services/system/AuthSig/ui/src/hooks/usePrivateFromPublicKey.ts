import { supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

export const usePublicToPrivate = (key: string | undefined | null) =>
  useQuery<string>({
    queryKey: ["privateToPublicKey", key],
    enabled: !!key,
    queryFn: async () => {
      const res = z.string().parse(
        await supervisor.functionCall({
          service: "auth-sig",
          intf: "keyvault",
          method: "privFromPub",
          params: [key],
        })
      );

      const encoder = new TextEncoder();
      const b64 = z.string().parse(
        await supervisor.functionCall({
          service: "base64",
          intf: "url",
          method: "encode",
          params: [encoder.encode(res)],
        })
      );

      return b64;
    },
  });
