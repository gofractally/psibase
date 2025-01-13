import { useLoggedInUser } from "@/hooks/useLoggedInUser";
import { Button } from "./ui/button";
import { useCreateConnectionToken } from "@/hooks/useCreateConnectionToken";
import { useSetMetadata } from "@/hooks/useSetMetadata";

export const AccountSelection = () => {
  const { status, mutateAsync } = useSetMetadata();

  const { data: currentUser } = useLoggedInUser();

  const { mutateAsync: login } = useCreateConnectionToken();

  const setMetadata = async () => {
    await mutateAsync({
      appHomepageSubpage: "",
      icon: "",
      iconMimeType: "",
      longDescription: "I dunno bro",
      name: "Derp",
      owners: ["a"],
      privacyPolicySubpage: "/privacy-policy",
      redirectUris: [],
      shortDescription: "Hello world",
      tags: [],
      tosSubpage: "/tos",
    });
  };

  return (
    <div>
      <div>Current user - {currentUser || "None"}</div>
      <div>Status: {status}</div>
      <div className="flex flex-col gap-4">
        <Button
          variant="outline"
          onClick={() => {
            login();
          }}
        >
          Login
        </Button>

        <Button
          onClick={() => {
            setMetadata();
          }}
          disabled={!currentUser}
        >
          Set metadata {!currentUser && "- Login to continue"}
        </Button>
      </div>
    </div>
  );
};
