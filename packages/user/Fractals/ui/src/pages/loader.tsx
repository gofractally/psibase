import { Gavel } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

export const Loader = () => {
    const { mutate: login } = useConnectAccount();
    const { data: currentUser, isPending } = useCurrentUser();

    const isLoggedIn = typeof currentUser === "string";

    const navigate = useNavigate();

    useEffect(() => {
        if (isLoggedIn) {
            navigate("/browse", { replace: true });
        }
    }, [isLoggedIn, navigate]);

    if (isPending || isLoggedIn) {
        return null;
    }

    return (
        <Card className="mx-auto mt-4 w-[350px]">
            <CardHeader>
                <div className="mx-auto">
                    <Gavel className="h-12 w-12" />
                </div>
                <CardTitle>Fractals</CardTitle>
                <CardDescription>
                    The fractals app allows users to create fractals and
                    participate in fractal governance.
                </CardDescription>
                <CardDescription>Log in to continue</CardDescription>
            </CardHeader>
            <CardFooter className="flex justify-end">
                <Button onClick={() => login()}>Log in</Button>
            </CardFooter>
        </Card>
    );
};
