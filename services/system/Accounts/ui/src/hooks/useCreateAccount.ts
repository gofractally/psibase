import { useMutation } from "@tanstack/react-query";
import { getSupervisor } from "@psibase/common-lib";
import { useDecodeInviteToken } from "./useDecodeInviteToken";
import { useDecodeToken } from "./useDecodeToken";
import { useImportAccount } from "./useImportAccount";

const supervisor = getSupervisor();

export const useCreateAccount = (token: string) => {
  const { data: decodedToken } = useDecodeToken(token);

  const { data: inviteToken } = useDecodeInviteToken(
    token,
    decodedToken?.tag == "invite-token"
  );

  const { mutateAsync: importAccount } = useImportAccount();

  return useMutation<void, string, string>({
    mutationFn: async (account) => {
      if (!inviteToken) throw new Error(`Must have invite`);

      void (await supervisor.functionCall({
        method: "logout",
        params: [],
        service: "accounts",
        intf: "activeApp",
      }));

      void (await supervisor.functionCall({
        method: "acceptWithNewAccount",
        params: [account, token],
        service: "invite",
        intf: "invitee",
      }));


      await importAccount(account);

      void (await supervisor.functionCall({
        method: "loginDirect",
        params: [
          {
            app: inviteToken.app,
            origin: inviteToken.appDomain,
          },
          account,
        ],
        service: "accounts",
        intf: "admin",
      }));
    },
  });
};
