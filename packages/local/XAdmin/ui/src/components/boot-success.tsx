import { CircleCheck } from "lucide-react";
import ConfettiExplosion from "react-confetti-explosion";
import { Link } from "react-router-dom";

import { siblingUrl } from "@psibase/common-lib";

import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

export const BootSuccess = () => {
    return (
        <div className="flex h-full items-center">
            <Card className="mx-auto mt-4 w-[350px]">
                <CardHeader>
                    <div className="relative mx-auto">
                        <CircleCheck className="h-12 w-12" />
                        <div className="absolute bottom-0 left-0 right-0 top-0 flex items-center justify-center">
                            <ConfettiExplosion />
                        </div>
                    </div>
                    <CardTitle>All done!</CardTitle>
                    <CardDescription>
                        The chain has been booted successfully
                    </CardDescription>
                </CardHeader>
                <CardFooter className="flex flex-col items-center gap-2">
                    <Button asChild variant="link">
                        <a href={siblingUrl("")}>Home</a>
                    </Button>
                    <Button asChild variant="link">
                        <Link to="/dashboard">Admin Dashboard</Link>
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
};
