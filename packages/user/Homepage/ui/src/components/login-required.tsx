import { ReactNode } from "react";

import { useCurrentUser } from "@/hooks/use-current-user";

import {
    Card,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

import { LoginButton } from "../login-button";

interface LoginRequiredProps {
    appName: string;
    appIcon?: ReactNode;
    appDescription?: string;
    children: ReactNode;
}

export const LoginRequired = ({
    appName,
    appIcon,
    appDescription,
    children,
}: LoginRequiredProps) => {
    const { data: currentUser, isPending: isPendingCurrentUser } =
        useCurrentUser();

    const isNotLoggedIn = !currentUser && !isPendingCurrentUser;

    if (isNotLoggedIn) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <div className="mx-auto mt-4 w-[350px]">
                    {/* Main app info card */}
                    <Card className="rounded-b-none border-b-0 shadow-sm">
                        <CardHeader>
                            {appIcon && <div className="mx-auto">{appIcon}</div>}
                            <CardTitle>{appName}</CardTitle>
                            {appDescription && (
                                <CardDescription>{appDescription}</CardDescription>
                            )}
                        </CardHeader>
                    </Card>

                    {/* Login prompt card */}
                    <Card className="bg-muted/50 rounded-t-none border-t-0">
                        <CardHeader className="pb-2 pt-4">
                            <CardDescription className="text-center font-medium">
                                {`Please log in to access ${appName}`}
                            </CardDescription>
                        </CardHeader>
                        <CardFooter className="flex justify-center pb-4">
                            <LoginButton />
                        </CardFooter>
                    </Card>
                </div>
            </div>
        );
    }

    return <>{children}</>;
};
