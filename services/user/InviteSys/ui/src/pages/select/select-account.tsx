import { useInviteToken } from "store/queries/usePrivateKey";
import { Button } from "components";
import { useParam } from "store";
import { useMutation } from "@tanstack/react-query";
import { psiboardApplet } from "service";

export const SelectAccount = () => {
  const account = useParam("account");
  const token = useParam("token");

  const { isValid, publicKey } = useInviteToken(token);
  console.log({ token, publicKey, isValid });

  const {
    error,
    data,
    mutate: accept,
    isSuccess,
    isLoading,
  } = useMutation({
    mutationFn: (publicKey: string) => {
      return psiboardApplet.acceptInvite(publicKey);
    },
    onError: (error) => {
      console.log("errored..", error);
    },
    onSuccess: (data) => {
      console.log("success fired!", data);
    },
  });

  if (!isValid) return <div className="text-red-500">Token is not valid!</div>;
  if (error) return <div className="text-red-500">{JSON.stringify(error)}</div>;

  return (
    <div>
      <div>Accept invite from fractally with account {account}?</div>
      <div className="w-full text-center pt-4">
        <Button type="primary" onClick={() => accept(publicKey)}>
          {isLoading ? "Loading" : isSuccess ? "Continue" : "Accept Invite"}
        </Button>
      </div>
    </div>
  );
};
