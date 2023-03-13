import { useInviteToken } from "store/queries/usePrivateKey";
import { Button } from "components";
import { useParam } from "store";
import { useMutation } from "@tanstack/react-query";
import { psiboardApplet } from "service";
import { AppletId, operation } from "common/rpc.mjs";

export const SelectAccount = () => {
  const account = useParam("account");
  const token = useParam("token");
  const ref = useParam('ref');

  const { isValid, publicKey, error: tokenError } = useInviteToken(token);

  const {
    error,
    data,
    mutate: accept,
    isSuccess,
    isLoading,
  } = useMutation({
    mutationFn: async ({ publicKey, privateKey}: { publicKey: string, privateKey: string }) => {
      const accountSys = new AppletId("account-sys", "");
      await operation(accountSys, "storeKey", { privateKey, publicKey });
      return psiboardApplet.acceptInvite(publicKey);
    },
    onError: (error) => {
      console.log("errored..", error);
    },
    onSuccess: (data) => {
      window.open(`http://psibase.127.0.0.1.sslip.io:8081/applet/fractal-sys?token=${token}`)
      console.log("success fired!", data);
    },
  });

  if (!isValid) return <div className="text-red-500">Token is not valid! {tokenError}</div>;
  if (error) return <div className="text-red-500">{JSON.stringify(error)}</div>;

  return (
    <div>
      <div>Accept invite from fractally with account {account}?</div>
      <div className="w-full text-center pt-4">
        <Button type="primary" onClick={() => accept({ publicKey, privateKey: token! })}>
          {isLoading ? "Loading" : isSuccess ? "Continue" : "Accept Invite"}
        </Button>
      </div>
    </div>
  );
};
