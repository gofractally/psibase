import { CircleCheck, LoaderCircle } from "lucide-react";
import {
    Card,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useGuildApplication } from "@/hooks/fractals/use-guild-application";
import { useGuildAccount } from "@/hooks/use-guild-account";
import { useNavigate } from "react-router-dom";

export const InviteResponse = () => {

    const guild = useGuildAccount();
    const { data: currentUser } = useCurrentUser();
    const { data: guildApplication, error } = useGuildApplication(guild, currentUser)
    const navigate = useNavigate();


    if (guildApplication) {
        navigate(`/guild/${guild}/applications/${currentUser}`)
    }

    if (error) {
        <Card className="mx-auto mt-4 w-[350px]">
            <CardHeader>
                <div className="mx-auto">
                    <CircleCheck className="h-12 w-12" />
                </div>
                <CardTitle>Failed to find invite / application</CardTitle>
                <CardDescription>Malformed invite</CardDescription>
            </CardHeader>
        </Card>
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
    )
};
