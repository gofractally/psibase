import { CircleCheck, LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useGuildAccount } from "@/hooks/use-guild-account";
import { usePushApplication } from "@/hooks/use-push-application";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import {
    Card,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

export const InviteResponse = () => {
    const guild = useGuildAccount();
    const { data: currentUser } = useCurrentUser();
    const navigate = useNavigate();

    const {
        mutateAsync: pushApplication,
        isIdle,
        error,
    } = usePushApplication(() => {
        navigate(`/guild/${guild}/membership/applicants/${currentUser}`);
    });

    useEffect(() => {
        if (guild && isIdle) {
            pushApplication([guild!]);
        }
    }, [isIdle, guild, pushApplication]);

    if (error) {
        <Card className="mx-auto mt-4 w-[350px]">
            <CardHeader>
                <div className="mx-auto">
                    <CircleCheck className="h-12 w-12" />
                </div>
                <CardTitle>Failed to find invite / application</CardTitle>
                <CardDescription>Malformed invite</CardDescription>
            </CardHeader>
        </Card>;
    }

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
};
