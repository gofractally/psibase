import ConfettiExplosion from "react-confetti-explosion";

import {
    Card,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { CircleCheck } from "lucide-react";

export const InviteResponse = () => {
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
