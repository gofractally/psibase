import { supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const ConnectionToken = z.object({
  tag: z.literal("connection-token"),
  val: z.object({
    app: z.string(),
    origin: z.string().url(),
  }),
});

const InviteToken = z.object({
  tag: z.literal("invite-token"),
  val: z.object({
    pk: z.bigint(),
    id: z.number(),
  }),
});

export const useDecodeToken = (token: string | undefined | null) => {
  return useQuery({
    queryKey: ["tokenInfo", token],
    enabled: !!token,
    queryFn: async () => {
      await supervisor.onLoaded();

      const res = InviteToken.or(ConnectionToken).parse(
        await supervisor.functionCall({
          method: "deserializeToken",
          params: [token],
          service: "accounts",
          intf: "api",
          plugin: "account-tokens",
        })
      );

      return res;
    },
  });
};
