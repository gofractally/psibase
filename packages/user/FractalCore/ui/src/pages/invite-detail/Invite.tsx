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

import { supervisor } from "@shared/lib/supervisor";
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
import { zDateTime } from "@/lib/zod/DateTime";
import { zAccount } from '@shared/lib/schemas/account'

dayjs.extend(relativeTime);

const zInviteDetailsResponse = z.object({
    data: z.object({
        inviteById: z.object({
            inviter: z.string(),
            numAccounts: z.number(),
            expiryDate: zDateTime.transform(date => new Date(date)),
        }),
    }),
});

const zGuildInviteDetailsResponse = z.object({
    data: z.object({
        guildInvite: z.object({
            createdAt: zDateTime,
            inviter: zAccount,
            guild: z.object({
                account: zAccount,
                bio: z.string(),
                displayName: z.string(),
                fractal: z.object({
                    name: z.string()
                })
            })
        }).nullable(),
    }),
});



export const fetchGuildInvite = async (inviteId: number) => {
    const response = await postGraphQLGetJson(
        siblingUrl(undefined, "fractals", "graphql", true),
        `
        {
            guildInvite(id: ${inviteId}) {
                createdAt
                guild {
                    account
                    bio
                    displayName
                    fractal {
                        name
                    }
                }
                inviter
            }
        }
        `,
    );
    return zGuildInviteDetailsResponse.parse(response).data.guildInvite;
}

const fetchInviteById = async (inviteId: number) => {

    const response = await postGraphQLGetJson(
        siblingUrl(undefined, "invite", "graphql", true),
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
    return zInviteDetailsResponse.parse(response).data.inviteById;
}

const fetchInvites = async (token: string) => {
    const inviteId = await supervisor.functionCall({
        service: "invite",
        intf: "invitee",
        method: "importInviteToken",
        params: [token],
    });

    const [guildInvite, vanillaInvite] = await Promise.all([fetchGuildInvite(inviteId), fetchInviteById(inviteId)]);

    return {
        guildInvite,
        vanillaInvite
    }
};

export const Invite = () => {
    const [searchParams] = useSearchParams();
    const token = searchParams.get("token");

    const {
        data: invite,
        error,
        isLoading,
    } = useQuery({
        enabled: !!token,
        queryKey: ["invite", token],
        queryFn: async () => fetchInvites(z.string().parse(token)),
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
    } else if (error) {
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
                    <CardDescription>
                        {error.message}
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
        const { guildInvite, vanillaInvite } = invite!;

        const now = new Date().valueOf();
        const isExpired = vanillaInvite.expiryDate.valueOf() < now || guildInvite == null;
        const expiry = vanillaInvite.expiryDate;

        const inviter = guildInvite?.inviter;

        const description = isExpired
            ? `This invitation expired ${dayjs().to(expiry)} (${dayjs(
                expiry,
            ).format("YYYY/MM/DD HH:mm")}).`
            : `${inviter} has invited you to apply to join the ${guildInvite.guild.displayName} guild in the ${guildInvite.guild.fractal.name} fractal.`;


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
                        <CardTitle>{`Apply to join the ${guildInvite.guild.displayName} guild.`}</CardTitle>
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
                                        returnPath: `/guild/${guildInvite.guild.account}/invite-response`,
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
