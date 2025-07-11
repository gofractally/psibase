import { supervisor } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const AcceptInviteParams = z.object({
    accountName: z.string(),
    token: z.string(),
    origin: z.string(),
    app: z.string(),
});

export const useAcceptInvite = () =>
    useMutation<void, string, z.infer<typeof AcceptInviteParams>>({
        mutationFn: async (params) => {
            const { accountName, app, origin, token } =
                AcceptInviteParams.parse(params);

            void (await supervisor.functionCall({
                method: "login",
                params: [accountName],
                service: "accounts",
                intf: "activeApp",
            }));

            void (await supervisor.functionCall({
                method: "accept",
                params: [token],
                service: "invite",
                intf: "invitee",
            }));

            const queryToken = await supervisor.functionCall({
                method: "loginDirect",
                params: [
                    {
                        app,
                        origin,
                    },
                    accountName,
                ],
                service: "accounts",
                intf: "admin",
            });
            console.log("queryToken:", queryToken);
        },
    });
