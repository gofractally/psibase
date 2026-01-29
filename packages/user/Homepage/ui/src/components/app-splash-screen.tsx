import { useNavLocation } from "@/hooks/use-nav-location";

import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { toast } from "@shared/shadcn/ui/sonner";

export const AppSplashScreen = () => {
    const { currentApp } = useNavLocation();
    const { mutate: login, isPending } = useConnectAccount({
        onError: (error) => {
            toast.error(error.message);
        },
    });

    return (
        <div className="mx-auto mt-4 w-[350px]">
            {/* Main app info card */}
            <Card className="rounded-b-none border-b-0 shadow-sm">
                <CardHeader>
                    <div className="mx-auto">{currentApp?.icon}</div>
                    <CardTitle>{currentApp?.name}</CardTitle>
                    <CardDescription>{currentApp?.description}</CardDescription>
                </CardHeader>
            </Card>

            {/* Login prompt card */}
            <Card className="bg-muted/50 rounded-t-none border-t-0">
                <CardHeader className="pb-2 pt-4">
                    <CardDescription className="text-center font-medium">
                        {`Please log in to access ${currentApp?.name}`}
                    </CardDescription>
                </CardHeader>
                <CardFooter className="flex justify-center pb-4">
                    <Button disabled={isPending} onClick={() => login()}>
                        Log in
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
};
