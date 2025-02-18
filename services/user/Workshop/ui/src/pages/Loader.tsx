import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTrackedApps } from "@/hooks/useTrackedApps";
import { Button } from "../components/ui/button";
import { useNavigate } from "react-router-dom";
import { useBranding } from "@/hooks/useBranding";
import { useEffect, useState } from "react";

import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Terminal } from "lucide-react";
import { LoginButton } from "../components/login-button";
import { CreateAppModal } from "../components/create-app-modal";
import { useExpectCurrentUser } from "@/hooks/useExpectCurrentUser";

export const Loader = () => {
  const { data: currentUser } = useCurrentUser();
  const navigate = useNavigate();

  const { apps } = useTrackedApps();
  const [expectCurrentUser] = useExpectCurrentUser();

  useEffect(() => {
    if (apps.length > 0 && (expectCurrentUser || currentUser)) {
      navigate(`/app/${apps[0]!.account}`);
    }
  }, [apps, navigate, expectCurrentUser, currentUser]);

  const { data: networkName } = useBranding();

  const isLoggedIn = typeof currentUser === "string";

  const [showModal, setShowModal] = useState<boolean>(false);

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
          <Terminal className="h-12 w-12" />
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
