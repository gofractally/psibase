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

            void (await supervisor.functionCall({
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
            }));

            if (window.location && window.location.href) {
                window.location.href = origin;
            } else {
                throw new Error(
                    `Failed to redirect window to origin ${origin}`,
                );
            }
        },
    });
