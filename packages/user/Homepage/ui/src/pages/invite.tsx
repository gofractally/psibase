import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { AlarmClockMinus, TicketCheck, TriangleAlert } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";

import { Loading } from "@/components/loading";
import { NoticeCard } from "@/components/notice-card";
import { KeyValue } from "@/components/page-header";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { invite as invitePlugin } from "@shared/lib/plugins";
import { supervisor } from "@shared/lib/supervisor";
import { Button } from "@shared/shadcn/ui/button";

dayjs.extend(relativeTime);

const inviteDetailsResponse = z.object({
    inviteById: z.object({
        inviter: z.string(),
        numAccounts: z.number(),
        expiryDate: z.string(),
    }),
});

const fetchInvite = async (token: string) => {
    const inviteId = await supervisor.functionCall({
        service: "invite",
        intf: "invitee",
        method: "importInviteToken",
        params: [token],
    });

    const response = await callGraphqlViaPlugin(
        invitePlugin.authorized.graphql,
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
    const inviteDetails = inviteDetailsResponse.parse(response).inviteById;

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

const Centered = ({ children }: { children: React.ReactNode }) => (
    <div className="grid-bg -m-4 flex flex-1 items-center justify-center p-4 md:-m-6 md:p-6">
        {children}
    </div>
);

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
            <Centered>
                <NoticeCard
                    icon={TriangleAlert}
                    tone="warning"
                    eyebrow="Invitation"
                    title="Token not found"
                    description="The invitation token is either invalid or does not exist."
                />
            </Centered>
        );
    }

    if (isError) {
        return (
            <Centered>
                <NoticeCard
                    icon={TriangleAlert}
                    tone="warning"
                    eyebrow="Invitation"
                    title="Invalid invitation"
                    description="The invitation token is either invalid or has already been used."
                />
            </Centered>
        );
    }

    if (isLoading || !invite) {
        return (
            <Centered>
                <Loading label="Checking invitation…" />
            </Centered>
        );
    }

    const now = new Date().valueOf();
    const isExpired = invite.expiry.valueOf() < now;
    const { inviter, chainName, expiry } = invite;

    if (isExpired) {
        return (
            <Centered>
                <NoticeCard
                    icon={AlarmClockMinus}
                    tone="warning"
                    eyebrow="Invitation"
                    title="Expired invitation"
                    description={
                        <>
                            This invitation expired {dayjs().to(expiry)} (
                            {dayjs(expiry).format("YYYY/MM/DD HH:mm")}). Ask{" "}
                            <span className="text-foreground font-mono">
                                {inviter}
                            </span>{" "}
                            for a new one.
                        </>
                    }
                />
            </Centered>
        );
    }

    return (
        <Centered>
            <NoticeCard
                icon={TicketCheck}
                eyebrow={String(chainName)}
                title={`You're invited to ${chainName}`}
                description={
                    <>
                        <span className="text-foreground font-mono">
                            {inviter}
                        </span>{" "}
                        has invited you to create an account on this network.
                    </>
                }
                footer={
                    <Button
                        size="sm"
                        className="h-8 w-full"
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
                }
            >
                <div className="bg-muted/30 w-full rounded-lg border text-left">
                    <KeyValue
                        label="Invited by"
                        className="py-2 sm:grid-cols-[100px_1fr]"
                    >
                        <span className="font-mono">{inviter}</span>
                    </KeyValue>
                    <KeyValue
                        label="Expires"
                        className="py-2 sm:grid-cols-[100px_1fr]"
                    >
                        <span
                            className="tabular-nums"
                            title={dayjs(expiry).format("YYYY/MM/DD HH:mm")}
                        >
                            {dayjs().to(expiry)}
                        </span>
                    </KeyValue>
                </div>
            </NoticeCard>
        </Centered>
    );
};
