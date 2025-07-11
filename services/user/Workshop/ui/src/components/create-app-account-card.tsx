import { useCreateApp } from "@/hooks/use-create-app";
import { useCurrentApp } from "@/hooks/useCurrentApp";
import { Account } from "@/lib/zodTypes";

import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

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
                {error && (
                    <div className="text-destructive">{error.message}</div>
                )}
                <Button
                    disabled={isPending}
                    onClick={() => {
                        createApp({
                            account: Account.parse(currentApp),
                            allowExistingAccount: true,
                        });
                    }}
                >
                    Create account
                </Button>
            </CardFooter>
        </Card>
    );
};
