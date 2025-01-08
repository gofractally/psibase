import { useLoggedInUser } from "@/hooks/useLoggedInUser";
import { supervisor } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { useCreateConnectionToken } from "@/hooks/useCreateConnectionToken";

export const AccountSelection = () => {
  const { mutateAsync: importAccount } = useMutation<void, string, string>({
    mutationFn: async (accountName) => {
      await supervisor.functionCall({
        method: "importAccount",
        params: [accountName],
        service: "accounts",
        intf: "admin",
      });
    },
  });

  // perform a login
  // engage the app, set the meta data

  console.log({ importAccount });

  const { data: currentUser } = useLoggedInUser();

  const { mutateAsync: login } = useCreateConnectionToken();

  return (
    <div>
      <div>Current user - {currentUser || "None"}</div>

      <Button
        onClick={() => {
          login();
        }}
      >
        Login
      </Button>
    </div>
  );
};
