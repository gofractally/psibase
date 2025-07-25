import dayjs from "dayjs";
import { AlarmClockMinus, TriangleAlert } from "lucide-react";

import {
    Card,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

import { useDecodeInviteToken } from "./hooks/useDecodeInviteToken";
import { useDecodeToken } from "./hooks/useDecodeToken";

export const InviteExpiredCard = ({ token }: { token: string }) => {
    const { data: decodedToken } = useDecodeToken(token);
    const { data: inviteToken } = useDecodeInviteToken(
        token,
        decodedToken?.tag == "invite-token",
    );
    const expiryMessage =
        inviteToken &&
        `This invitation expired ${dayjs().to(inviteToken.expiry)} (${dayjs(
            inviteToken.expiry,
        ).format("YYYY/MM/DD HH:mm")}).`;
    return (
        <Card className="mx-auto mt-4 w-[350px]">
            <CardHeader>
                <div className="mx-auto">
                    <AlarmClockMinus className="h-12 w-12" />
                </div>
                <CardTitle>Expired invitation</CardTitle>
                <CardDescription>{expiryMessage}</CardDescription>
                <CardDescription>
                    Please ask the sender{" "}
                    <span className="text-primary">{inviteToken?.inviter}</span>{" "}
                    for a new one.
                </CardDescription>
            </CardHeader>
        </Card>
    );
};

export const InviteAlreadyAcceptedCard = ({ token }: { token: string }) => {
    const { data: decodedToken } = useDecodeToken(token);
    const { data: inviteToken } = useDecodeInviteToken(
        token,
        decodedToken?.tag == "invite-token",
    );
    return (
        <Card className="mx-auto mt-4 w-[350px]">
            <CardHeader>
                <div className="mx-auto">
                    <TriangleAlert className="h-12 w-12" />
                </div>
                <CardTitle>Invitation already accepted.</CardTitle>
                <CardDescription>
                    This invitation has been accepted by{" "}
                    <span className="text-primary font-semibold">
                        {inviteToken?.actor}
                    </span>
                    .
                </CardDescription>
            </CardHeader>
        </Card>
    );
};

export const InviteRejectedCard = ({ token }: { token: string }) => {
    const { data: decodedToken } = useDecodeToken(token);
    const { data: inviteToken } = useDecodeInviteToken(
        token,
        decodedToken?.tag == "invite-token",
    );
    return (
        <Card className="mx-auto mt-4 w-[350px]">
            <CardHeader>
                <div className="mx-auto">
                    <TriangleAlert className="h-12 w-12" />
                </div>
                <CardTitle>Invitation rejected.</CardTitle>
                <CardDescription>
                    This invitation has been rejected
                    {inviteToken?.actor !== "invite-sys"
                        ? ` by ${inviteToken?.actor}.`
                        : "."}
                </CardDescription>
            </CardHeader>
        </Card>
    );
};
