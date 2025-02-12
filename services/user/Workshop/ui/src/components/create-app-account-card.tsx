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
        <CardTitle>Account not found</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground">
        Account {currentApp} does not exist, click continue to create{" "}
        <span className="text-primary"> {currentApp}</span> as an app.
      </CardContent>
      <CardFooter>
        {error && <div className="text-destructive">{error.message}</div>}
        <Button
          disabled={isPending}
          onClick={() => {
            createApp(currentApp);
          }}
        >
          Create account
        </Button>
      </CardFooter>
    </Card>
  );
};
