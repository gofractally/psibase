import { LoaderCircle, Terminal } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useCurrentUser } from "@/hooks/useCurrentUser";

import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

export const Loader = () => {
    const navigate = useNavigate();

    const { data: currentUser, isPending } = useCurrentUser();
    const { mutate: login } = useConnectAccount();

    useEffect(() => {
        if (currentUser) {
            navigate(`/block-production`);
        }
    }, [currentUser, navigate]);

    return (
        <Card className="mx-auto mt-4 w-[350px]">
            <CardHeader>
                <div className="mx-auto">
                    <Terminal className="h-12 w-12" />
                </div>
                <CardTitle>Config</CardTitle>
                <CardDescription>Live network administration.</CardDescription>
                <CardFooter className="flex min-h-10 items-center">
                    {isPending ? (
                        <div className="flex flex-1 justify-center">
                            <LoaderCircle className="animate-spin" />
                        </div>
                    ) : (
                        <div className="flex flex-1 justify-end">
                            <Button
                                disabled={isPending}
                                onClick={() => login()}
                            >
                                Login
                            </Button>
                        </div>
                    )}
                </CardFooter>
            </CardHeader>
        </Card>
    );
};
