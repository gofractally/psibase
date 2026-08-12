import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shared/shadcn/ui/card";

import { useConnectAccount } from "@shared/hooks/use-connect-account";

export function LoginGate({ children }: { children: React.ReactNode }) {
    const { data: user, isLoading } = useCurrentUser();
    const { mutateAsync: login, isPending } = useConnectAccount();

    if (isLoading) {
        return (
            <p className="text-muted-foreground text-sm">Checking session…</p>
        );
    }

    if (!user) {
        return (
            <Card className="mx-auto max-w-md">
                <CardHeader>
                    <CardTitle>Sign in to use Banx</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-muted-foreground text-sm">
                        Banx is a mutual-credit graph: credit lines, deposits,
                        path payments, and FX rebooking. Connect an account to
                        manage your positions.
                    </p>
                    <Button
                        disabled={isPending}
                        onClick={() =>
                            login({
                                enabled: true,
                                returnPath: location.pathname,
                            })
                        }
                    >
                        {isPending ? "Connecting…" : "Connect account"}
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return <>{children}</>;
}
