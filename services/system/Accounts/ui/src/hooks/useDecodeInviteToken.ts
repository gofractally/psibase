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

export const useDecodeInviteToken = (
    token: string | undefined | null,
    enabled: boolean,
) =>
    useQuery({
        queryKey: ["invite", token],
        enabled,
        queryFn: async () => {
            await supervisor.onLoaded();
            const tokenRes = DecodedToken.parse(
                await supervisor.functionCall({
                    service: "invite",
                    intf: "invitee",
                    method: "decodeInvite",
                    params: [token],
                }),
            );

            return {
                ...tokenRes,
                expiry: new Date(tokenRes.expiry),
            };
        },
    });
