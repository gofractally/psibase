import { LogIn } from "lucide-react";
import { useLocation } from "react-router-dom";

import { useNavLocation } from "@/hooks/use-nav-location";

import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { Button } from "@shared/shadcn/ui/button";
import { toast } from "@shared/shadcn/ui/sonner";

export const AppSplashScreen = () => {
    const location = useLocation();
    const { currentApp } = useNavLocation();
    const { mutate: login, isPending } = useConnectAccount({
        onError: (error) => {
            toast.error(error.message);
        },
    });

    const onLogin = () => {
        login({
            enabled: true,
            returnPath: `${location.pathname}${location.search}${location.hash}`,
        });
    };

    return (
        <div className="bg-card/70 mx-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border p-8 text-center shadow-sm backdrop-blur">
            <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-xl border [&_svg]:size-6">
                {currentApp?.icon}
            </div>
            <div className="space-y-1">
                <h1 className="text-lg font-semibold tracking-tight">
                    {currentApp?.name}
                </h1>
                <p className="text-muted-foreground text-sm">
                    {currentApp?.description}
                </p>
            </div>
            <div className="text-muted-foreground text-xs">
                Sign in to use {currentApp?.name ?? "this app"}.
            </div>
            <Button
                size="sm"
                className="h-8"
                disabled={isPending}
                onClick={onLogin}
            >
                <LogIn className="size-3.5" /> Log in
            </Button>
        </div>
    );
};
