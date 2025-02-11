import { useCurrentApp } from "@/hooks/useCurrentApp";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "./ui/button";
import { useCreateApp } from "@/hooks/use-create-app";

export const CreateAppAccountCard = () => {
  const currentApp = useCurrentApp();

  const { mutateAsync: createApp, isPending, error } = useCreateApp();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{currentApp} not found</CardTitle>
      </CardHeader>
      <CardContent>
        <p>
          {currentApp} is not currently an app, continue to create and list on
          the registry{" "}
        </p>
      </CardContent>
      <CardFooter>
        {error && <div className="text-destructive">{error.message}</div>}
        <Button
          disabled={isPending}
          onClick={() => {
            createApp(currentApp);
          }}
        >
          Create app
        </Button>
      </CardFooter>
    </Card>
  );
};
