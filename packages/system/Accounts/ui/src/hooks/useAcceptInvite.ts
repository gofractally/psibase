import { supervisor } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const AcceptInviteParams = z.object({
    accountName: z.string(),
    token: z.string(),
    app: z.string(),
});

export const useAcceptInvite = () => {
    return useMutation<void, string, z.infer<typeof AcceptInviteParams>>({
        mutationFn: async (params) => {
            const { accountName, app, token } =
                AcceptInviteParams.parse(params);

            console.log("useAcceptInvite().1");
            void (await supervisor.functionCall({
                method: "login",
                params: [accountName],
                service: "accounts",
                intf: "activeApp",
            }));

            console.log("useAcceptInvite().2");
            void (await supervisor.functionCall({
                method: "accept",
                params: [token],
                service: "invite",
                intf: "invitee",
            }));

            console.log("useAcceptInvite().3");
            const queryToken = await supervisor.functionCall({
                method: "loginDirect",
                params: [app, accountName],
                service: "accounts",
                intf: "admin",
            });
            console.log("queryToken:", queryToken);
        },
    });
};
