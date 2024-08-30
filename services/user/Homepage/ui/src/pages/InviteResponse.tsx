import { Link, useSearchParams } from "react-router-dom";
import ConfettiExplosion from "react-confetti-explosion";

import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { CircleCheck } from "lucide-react";

export const InviteResponse = () => {
    const [searchParams] = useSearchParams();

    const token = searchParams.get("token");

    return (
        <Card className="mx-auto mt-4 w-[350px]">
            <ConfettiExplosion />
            <CardHeader>
                <div className="mx-auto">
                    <CircleCheck className="h-12 w-12" />
                </div>
                <CardTitle>Accepted invite</CardTitle>
                <CardDescription>Welcome to X chain name</CardDescription>
            </CardHeader>
        </Card>
    );
};
