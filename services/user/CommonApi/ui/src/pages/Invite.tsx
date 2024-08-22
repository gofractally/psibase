import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

const wait = (ms = 1000) => new Promise((resolve) => setTimeout(resolve, ms));

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

export const Invite = () => {
    const [searchParams] = useSearchParams();
    const token = searchParams.get("token");

    const { data, isError, isLoading } = useQuery({
        enabled: !!token,
        queryKey: ["invite", token],
        queryFn: async () => {
            await wait(1000);
            return {
                chainName: "psibase",
                inviter: "purplebear",
            };
        },
    });

    console.log({ data });

    if (isError) {
        // render error looking card
        return <div>loading</div>;
    } else if (isLoading) {
        /// render loading card...
        return <div>loading</div>;
    } else {
        const isExpired = false;

        const inviter = data?.inviter;
        const chainName = data?.chainName;

        return (
            <div className="flex h-full justify-center">
                <div className="flex h-full flex-col justify-center ">
                    <Card className="w-[350px]">
                        <CardHeader>
                            <CardTitle>
                                {isExpired
                                    ? "Expired invitation"
                                    : `You're invited to ${chainName}`}
                            </CardTitle>
                            <CardDescription>
                                {isExpired
                                    ? "This invitation expired at 21/2032, please ask the sender for a new one."
                                    : `${inviter} has invited you to create an account
                                on the ${chainName} platform.`}
                            </CardDescription>
                        </CardHeader>
                        <CardContent></CardContent>
                        {!isExpired && (
                            <CardFooter className="flex justify-between">
                                <Button
                                    variant="link"
                                    className="text-muted-foreground"
                                >
                                    Reject
                                </Button>
                                <Button>Accept</Button>
                            </CardFooter>
                        )}
                    </Card>
                </div>
            </div>
        );
    }
};
