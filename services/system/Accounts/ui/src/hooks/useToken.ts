import { supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const DecodedToken = z.object({
  inviter: z.string(),
  app: z.string(),
  appDomain: z.string().url(),
  state: z.enum(["pending", "accepted", "rejected"]),
  actor: z.string(),
  expiry: z.string().datetime(),
});

export const useDecodeToken = (
  token: string | undefined | null,
  ping = false
) =>
  useQuery({
    queryKey: ["invite", token],
    refetchInterval: ping ? 2000 : false,
    enabled: !!token,
    queryFn: async () => {
      await supervisor.onLoaded();
      const tokenRes = DecodedToken.parse(
        await supervisor.functionCall({
          service: "invite",
          intf: "invitee",
          method: "decodeInvite",
          params: [token],
        })
      );

      return {
        ...tokenRes,
        expiry: new Date(tokenRes.expiry),
      };
    },
  });
