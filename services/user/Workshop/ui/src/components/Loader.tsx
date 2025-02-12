import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTrackedApps } from "@/hooks/useTrackedApps";
import { Button } from "./ui/button";
import { useNavigate } from "react-router-dom";
import { useBranding } from "@/hooks/useBranding";
import { useEffect, useState } from "react";

import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Drill } from "lucide-react";
import { LoginButton } from "./login-button";
import { CreateAppModal } from "./create-app-modal";
import { useAutoNavigate } from "@/hooks/useAutoNav";

export const Loader = () => {
  const { data: currentUser, isLoading } = useCurrentUser();
  const navigate = useNavigate();

  const { apps } = useTrackedApps();
  const [autoNavigate] = useAutoNavigate();

  useEffect(() => {
    if (apps.length > 0 && (autoNavigate || currentUser)) {
      console.log(apps, "are the apps");
      const firstApp = apps[0]!;
      console.log({ firstApp });
      navigate(`/app/${firstApp.account}`);
    }
  }, [apps, navigate]);

  const { data: networkName } = useBranding();

  const isLoggedInWithNoApps = currentUser && apps.length == 0;
  const isLoggedInWithApps = currentUser && apps.length > 0;
  const isNotLoggedIn = currentUser === null;
  const isLoggedIn = typeof currentUser === "string";

  console.log({
    isLoading,
    isLoggedInWithApps,
    isLoggedInWithNoApps,
    isNotLoggedIn,
  });

  const [showModal, setShowModal] = useState<boolean>(false);

  // Display loader
  // If logged in, no apps, prompt to create a new app or look one up
  // If not logged in, display what the workshop is about and prompt a login
  // Figure out if there's any apps

  return (
    <Card className="mx-auto mt-4 w-[350px]">
      <CreateAppModal
        show={showModal}
        openChange={(e) => {
          setShowModal(e);
        }}
      />
      <CardHeader>
        <div className="mx-auto">
          <Drill className="h-12 w-12" />
        </div>
        <CardTitle>Workshop</CardTitle>
        <CardDescription>
          {`The workshop app allows developers to deploy apps on the ${
            networkName ? `${networkName} ` : ""
          }network.`}
        </CardDescription>

        <CardDescription>
          {isLoggedIn ? "Add an app to continue" : "Login to continue"}
        </CardDescription>
        <CardFooter className="flex justify-end">
          {isLoggedIn ? (
            <Button
              onClick={() => {
                setShowModal(true);
              }}
            >
              Add app
            </Button>
          ) : (
            <LoginButton />
          )}
        </CardFooter>
      </CardHeader>
    </Card>
  );
};
