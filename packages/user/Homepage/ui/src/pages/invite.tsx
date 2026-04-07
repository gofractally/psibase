import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
    AlarmClockMinus,
    LoaderCircle,
    TicketCheck,
    TriangleAlert,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";

import { supervisor } from "@/supervisor";
import { postGraphQLGetJson, siblingUrl } from "@psibase/common-lib";

import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

dayjs.extend(relativeTime);

const inviteDetailsResponse = z.object({
    data: z.object({
        inviteById: z.object({
            inviter: z.string(),
            numAccounts: z.number(),
            expiryDate: z.string(),
        }),
    }),
});

const fetchInvite = async (token: string) => {
    const inviteId = await supervisor.functionCall({
        service: "invite",
        intf: "invitee",
        method: "importInviteToken",
        params: [token],
    });

    const response = await postGraphQLGetJson(
        siblingUrl(undefined, "invite", "graphql", false),
        `
            query InviteById {
                inviteById(inviteId: ${inviteId}) {
                    inviter
                    numAccounts
                    expiryDate
                }
            }
        `,
    );
    const inviteDetails = inviteDetailsResponse.parse(response).data.inviteById;

    const networkName = await supervisor.functionCall({
        service: "branding",
        intf: "queries",
        method: "getNetworkName",
        params: [],
    });

    return {
        chainName: networkName,
        inviter: inviteDetails.inviter,
        expiry: new Date(inviteDetails.expiryDate),
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
                        <Button
                            onClick={async () => {
                                await supervisor.functionCall(
                                    {
                                        service: "accounts",
                                        intf: "activeApp",
                                        method: "connectAccount",
                                        params: [],
                                    },
                                    {
                                        enabled: true,
                                        returnPath: "/invite-response",
                                    },
                                );
                            }}
                        >
                            Continue
                        </Button>
                    </CardFooter>
                </Card>
            );
        }
    }
};
