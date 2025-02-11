import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTrackedApps } from "@/hooks/useTrackedApps";
import { Button } from "./ui/button";
import { useNavigate } from "react-router-dom";
import { IntroCard } from "./intro-card";
import { useCreateConnectionToken } from "@/hooks/useCreateConnectionToken";
import { useBranding } from "@/hooks/useBranding";
import { useEffect } from "react";
import { Spinner } from "./ui/spinner";

export const Loader = () => {
  const { data: currentUser, isLoading } = useCurrentUser();

  const { apps } = useTrackedApps(currentUser);

  const { mutate: login } = useCreateConnectionToken();

  const { data: networkName } = useBranding();

  const isLoggedInWithNoApps = currentUser && apps.length == 0;
  const isLoggedInWithApps = currentUser && apps.length > 0;
  const isNotLoggedIn = currentUser === null;

  const navigate = useNavigate();

  console.log({
    isLoading,
    isLoggedInWithApps,
    isLoggedInWithNoApps,
    isNotLoggedIn,
  });

  useEffect(() => {
    navigate("/app/monsters");
  }, []);

  // Display loader
  // If logged in, no apps, prompt to create a new app or look one up
  // If not logged in, display what the workshop is about and prompt a login
  // Figure out if there's any apps

  if (isLoading) {
    return (
      <div>
        i am loading
        <Spinner />
      </div>
    );
  } else if (isNotLoggedIn) {
    return (
      <IntroCard
        networkName={networkName || ""}
        onLogin={() => {
          login();
        }}
      />
    );
  }

  return (
    <div>
      <div className="p-4">Current user: {currentUser}</div>
      <Button
        onClick={() => {
          navigate("/app/derp");
        }}
      >
        Go to derp
      </Button>
    </div>
  );
};
