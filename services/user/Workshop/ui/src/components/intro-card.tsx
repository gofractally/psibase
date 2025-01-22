import { Drill } from "lucide-react";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Button } from "./ui/button";

interface Props {
  networkName?: string;
  onLogin: () => void;
}

export const IntroCard = ({ networkName, onLogin }: Props) => {
  return (
    <Card className="mx-auto mt-4 w-[350px]">
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
        <CardDescription>Select your app account to continue</CardDescription>
        <CardFooter className="flex justify-end">
          <Button
            onClick={() => {
              onLogin();
            }}
          >
            Login
          </Button>
        </CardFooter>
      </CardHeader>
    </Card>
  );
};
