import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";

import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Terminal } from "lucide-react";
import { LoginButton } from "../components/login-button";

export const Loader = () => {
  const { data: currentUser } = useCurrentUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (currentUser) {
      navigate(`/block-production`);
    }
  }, [currentUser, navigate]);


  const isLoggedIn = typeof currentUser === "string";


  return (
    <Card className="mx-auto mt-4 w-[350px]">
     
      <CardHeader>
        <div className="mx-auto">
          <Terminal className="h-12 w-12" />
        </div>
        <CardTitle>Config</CardTitle>
        <CardDescription>
          Live network administration.
        </CardDescription>

        <CardDescription>
          {isLoggedIn && "Login to continue"}
        </CardDescription>
        <CardFooter className="flex justify-end">
          {!isLoggedIn &&  (
            <LoginButton />
          )}
        </CardFooter>
      </CardHeader>
    </Card>
  );
};
