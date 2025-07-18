import { useMutation } from "@tanstack/react-query";

import { getSupervisor } from "@psibase/common-lib";

import { useLogout } from "./use-logout";
import { useDecodeInviteToken } from "./useDecodeInviteToken";
import { useDecodeToken } from "./useDecodeToken";

const supervisor = getSupervisor();

export const useRejectInvite = (selectedAccount: string, token: string) => {
    const { data: decodedToken } = useDecodeToken(token);
    const { data: inviteToken, refetch: refetchToken } = useDecodeInviteToken(
        token,
        decodedToken?.tag == "invite-token",
    );
    const { mutateAsync: logout } = useLogout();

    return useMutation({
        onSuccess: () => {
            refetchToken();
            setTimeout(() => {
                refetchToken();
            }, 3000);
        },
        mutationFn: async () => {
            if (!inviteToken) {
                throw new Error(`No invite available`);
            }

            const rejectParams = {
                method: "reject",
                params: [token],
                service: "invite",
                intf: "invitee",
            };
            if (selectedAccount) {
                void (await supervisor.functionCall({
                    method: "login",
                    params: [selectedAccount],
                    service: "accounts",
                    intf: "activeApp",
                }));

                void (await supervisor.functionCall(rejectParams));
            } else {
                // Use proper logout hook that includes cookie deletion
                await logout();

                void (await supervisor.functionCall(rejectParams));
            }
        },
    });
};
