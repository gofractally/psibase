import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

import { useCreateApp } from "@/hooks/use-create-app";
import { useCurrentFractal } from "@/hooks/useCurrentFractal";
import { Account } from "@/lib/zodTypes";

import { Button } from "./ui/button";

export const CreateAppAccountCard = () => {
    const currentFractal = useCurrentFractal();
    const { mutateAsync: createApp, isPending, error } = useCreateApp();

    return (
        <Card>
            <CardHeader>
                <CardTitle>Account not found</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground">
                Account {currentFractal} does not exist, click continue to
                create <span className="text-primary"> {currentFractal}</span>{" "}
                as fractal.
            </CardContent>
            <CardFooter>
                {error && (
                    <div className="text-destructive">{error.message}</div>
                )}
                <Button
                    disabled={isPending}
                    onClick={() => {
                        createApp({
                            account: Account.parse(currentFractal),
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
