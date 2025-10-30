import { CircleCheck, LoaderCircle } from "lucide-react";
import ConfettiExplosion from "react-confetti-explosion";

import { useBranding } from "@/hooks/use-branding";

import {
    Card,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

export const InviteResponse = () => {
    const { data: networkName, isLoading } = useBranding();

    if (isLoading) {
        return (
            <Card className="mx-auto mt-4 w-[350px]">
                <CardHeader>
                    <div className="mx-auto">
                        <LoaderCircle className="h-12 w-12 animate-spin" />
                    </div>
                    <CardTitle className="text-center">Loading...</CardTitle>
                </CardHeader>
            </Card>
        );
    }

    return (
        <Card className="mx-auto mt-4 w-[350px]">
            <ConfettiExplosion />
            <CardHeader>
                <div className="mx-auto">
                    <CircleCheck className="h-12 w-12" />
                </div>
                <CardTitle>Accepted invite</CardTitle>
                <CardDescription>{`Welcome to ${networkName}`}</CardDescription>
            </CardHeader>
        </Card>
    );
};
