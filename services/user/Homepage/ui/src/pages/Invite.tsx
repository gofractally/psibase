import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";

const wait = (ms = 1000) => new Promise((resolve) => setTimeout(resolve, ms));

import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import dayjs from "dayjs";

import relativeTime from "dayjs/plugin/relativeTime";
import {
    AlarmClockMinus,
    LoaderCircle,
    TicketCheck,
    TriangleAlert,
} from "lucide-react";
import {  siblingUrl } from "@psibase/common-lib";
import { modifyUrlParams } from "@/lib/modifyUrlParams";
import { z } from "zod";
import { supervisor } from "@/supervisor";

dayjs.extend(relativeTime);

const inviteObject = z.object({
    actor: z.string(),
    app: z.string().optional(),
    appDomain: z.string(),
    expiry: z.string(),
    inviter: z.string(),
    state: z.enum(["pending", "accepted", "rejected"]),
});

const fetchInvite = async (token: string) => {

    const tokenRes = await supervisor.functionCall({
        service: "invite",
        intf: "invitee",
        method: "decodeInvite",
        params: [token],
    });

    const parsedToken = inviteObject.parse(tokenRes);

    return {
        chainName: "psibase",
        inviter: parsedToken.inviter,
        expiry: new Date(parsedToken.expiry),
    };
};

export const Invite = () => {
    const [searchParams] = useSearchParams();
    const token = searchParams.get("token");

    const {
        data: invite,
        isError,
        isLoading,
    } = useQuery({
        enabled: !!token,
        queryKey: ["invite", token],
        queryFn: async () => fetchInvite(z.string().parse(token)),
    });

    if (!token) {
        return (
            <Card className="mx-auto mt-4 w-[350px]">
                <CardHeader>
                    <div className="mx-auto">
                        <TriangleAlert className="h-12 w-12" />
                    </div>
                    <CardTitle>Token not found.</CardTitle>
                    <CardDescription>
                        The invitation token is either invalid or does not
                        exist.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    } else if (isError) {
        return (
            <Card className="mx-auto mt-4 w-[350px]">
                <CardHeader>
                    <div className="mx-auto">
                        <TriangleAlert className="h-12 w-12" />
                    </div>
                    <CardTitle>Error.</CardTitle>
                    <CardDescription>
                        The invitation token is either invalid or has already
                        been used.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    } else if (isLoading) {
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
    } else {
        const now = new Date().valueOf();
        const isExpired = invite!.expiry.valueOf() < now;

        const inviter = invite?.inviter;
        const chainName = invite?.chainName;

        const description = isExpired
            ? `This invitation expired ${dayjs().to(invite!.expiry)} (${dayjs(
                  invite!.expiry,
              ).format("YYYY/MM/DD HH:mm")}).`
            : `${inviter} has invited you to create an account
        on the ${chainName} platform.`;

        const accountsUrl = siblingUrl(undefined, "accounts", undefined, false);
        const redirect = siblingUrl(
            undefined,
            undefined,
            "invite-response",
            false,
        );

        const link = modifyUrlParams(accountsUrl, {
            token,
            redirect,
        });

        if (isExpired) {
            return (
                <Card className="mx-auto mt-4 w-[350px]">
                    <CardHeader>
                        <div className="mx-auto">
                            <AlarmClockMinus className="h-12 w-12" />
                        </div>
                        <CardTitle>Expired invitation</CardTitle>
                        <CardDescription>{description}</CardDescription>
                        <CardDescription>
                            Please ask the sender{" "}
                            <span className="text-primary">{inviter}</span> for
                            a new one.
                        </CardDescription>
                    </CardHeader>
                </Card>
            );
        } else {
            return (
                <Card className="mx-auto mt-4 w-[350px]">
                    <CardHeader>
                        <div className="mx-auto">
                            <TicketCheck className="h-12 w-12" />
                        </div>
                        <CardTitle>{`You're invited to ${chainName}`}</CardTitle>
                        <CardDescription>{description}</CardDescription>
                    </CardHeader>
                    <CardContent></CardContent>
                    <CardFooter className="flex justify-between">
                        <Link to={link}>
                            <Button>Continue</Button>
                        </Link>
                    </CardFooter>
                </Card>
            );
        }
    }
};
