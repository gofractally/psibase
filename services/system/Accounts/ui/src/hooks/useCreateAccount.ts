import { useMutation } from "@tanstack/react-query";

import { getSupervisor } from "@psibase/common-lib";

import { useLogout } from "./use-logout";
import { useDecodeInviteToken } from "./useDecodeInviteToken";
import { useDecodeToken } from "./useDecodeToken";
import { useImportAccount } from "./useImportAccount";

const supervisor = getSupervisor();
const wait = (ms = 1000) => new Promise((resolve) => setTimeout(resolve, ms));

export const useCreateAccount = (token: string) => {
    const { data: decodedToken } = useDecodeToken(token);

    const { data: inviteToken } = useDecodeInviteToken(
        token,
        decodedToken?.tag == "invite-token",
    );

    const { mutateAsync: importAccount } = useImportAccount();
    const { mutateAsync: logout } = useLogout();

    return useMutation<void, string, string>({
        mutationFn: async (account) => {
            if (!inviteToken) throw new Error(`Must have invite`);

            // Use proper logout hook that includes cookie deletion
            await logout();

            void (await supervisor.functionCall({
                method: "acceptWithNewAccount",
                params: [account, token],
                service: "invite",
                intf: "invitee",
            }));

            await wait(2000);

            await importAccount(account);
        },
    });
};
