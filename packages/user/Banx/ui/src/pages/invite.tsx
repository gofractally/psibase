import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    AlarmClockMinus,
    LoaderCircle,
    TicketCheck,
    TriangleAlert,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";

import { useAssetMap } from "@/hooks/use-assets";
import { displayAmount } from "@/lib/amount";
import { formatGracePeriod, ppmToPercent } from "@/lib/constants";
import { fetchInvite } from "@/lib/graphql";
import { importInviteToken, rejectActiveInvite } from "@/lib/invite";

import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

export function InvitePage() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get("token");
    const navigate = useNavigate();
    const { data: user } = useCurrentUser();
    const { symbolOf } = useAssetMap();
    const { mutateAsync: connectAccount, isPending: connecting } =
        useConnectAccount();

    const imported = useQuery({
        enabled: !!token,
        queryKey: ["banx", "importInvite", token],
        queryFn: () => importInviteToken(z.string().parse(token)),
        retry: false,
        staleTime: Infinity,
    });

    const inviteId = imported.data;
    const invite = useQuery({
        enabled: inviteId !== undefined,
        queryKey: ["banx", "invite", inviteId],
        queryFn: () => fetchInvite(inviteId!),
        retry: false,
    });

    useEffect(() => {
        if (inviteId === undefined || invite.isLoading) return;
        const row = invite.data;
        if (invite.error || !row) {
            void rejectActiveInvite();
            return;
        }
        const expired = row.expiry > 0 && row.expiry * 1000 < Date.now();
        if (expired) void rejectActiveInvite();
    }, [inviteId, invite.isLoading, invite.error, invite.data]);

    const claim = async () => {
        await connectAccount({
            enabled: true,
            returnPath: "/accounts",
        });
        navigate("/accounts", { replace: true });
    };

    if (!token) {
        return (
            <Card className="mx-auto mt-4 w-[350px]">
                <CardHeader>
                    <div className="mx-auto">
                        <TriangleAlert className="h-12 w-12" />
                    </div>
                    <CardTitle>Token not found</CardTitle>
                    <CardDescription>
                        This invitation link is missing its token. Ask the
                        sender for a new one.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    if (imported.isLoading || invite.isLoading) {
        return (
            <Card className="mx-auto mt-4 w-[350px]">
                <CardHeader>
                    <div className="mx-auto">
                        <LoaderCircle className="h-12 w-12 animate-spin" />
                    </div>
                    <CardTitle className="text-center">Loading…</CardTitle>
                </CardHeader>
            </Card>
        );
    }

    if (imported.error) {
        return (
            <Card className="mx-auto mt-4 w-[350px]">
                <CardHeader>
                    <div className="mx-auto">
                        <TriangleAlert className="h-12 w-12" />
                    </div>
                    <CardTitle>Invalid invitation</CardTitle>
                    <CardDescription>
                        {imported.error.message ||
                            "This invitation token is not valid."}
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    const row = invite.data;
    if (invite.error || !row) {
        return (
            <Card className="mx-auto mt-4 w-[350px]">
                <CardHeader>
                    <div className="mx-auto">
                        <TriangleAlert className="h-12 w-12" />
                    </div>
                    <CardTitle>Invite not found</CardTitle>
                    <CardDescription>
                        This Banx invite was already claimed, revoked, or never
                        existed. Ask the sender for a new one.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    const now = Date.now();
    const expired = row.expiry > 0 && row.expiry * 1000 < now;
    if (expired) {
        return (
            <Card className="mx-auto mt-4 w-[350px]">
                <CardHeader>
                    <div className="mx-auto">
                        <AlarmClockMinus className="h-12 w-12" />
                    </div>
                    <CardTitle>Expired invitation</CardTitle>
                    <CardDescription>
                        This invitation from {row.inviter} has expired. Ask them
                        for a new one.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    const symbol = symbolOf(row.assetId);
    const limit = displayAmount(row.limit);

    return (
        <Card className="mx-auto mt-4 w-[350px]">
            <CardHeader>
                <div className="mx-auto">
                    <TicketCheck className="h-12 w-12" />
                </div>
                <CardTitle>Join Banx</CardTitle>
                <CardDescription>
                    <span className="text-foreground font-medium">
                        {row.inviter}
                    </span>{" "}
                    invited you onto the network and Banx, with a credit line of{" "}
                    <span className="text-foreground font-medium">
                        {limit} {symbol}
                    </span>
                    . If you already have an account, claiming applies the line
                    to it (skipped if they already lined you in {symbol}).
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <dl className="text-muted-foreground grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <dt>Limit</dt>
                    <dd className="text-foreground text-right font-mono">
                        {limit} {symbol}
                    </dd>
                    <dt>APR</dt>
                    <dd className="text-foreground text-right">
                        {ppmToPercent(row.interestRatePpm)}
                    </dd>
                    <dt>Interest-free</dt>
                    <dd className="text-foreground text-right">
                        {formatGracePeriod(row.graceSeconds)}
                    </dd>
                </dl>
                <Button
                    className="w-full"
                    disabled={connecting}
                    onClick={() => void claim()}
                >
                    {connecting
                        ? "Connecting…"
                        : user
                          ? `Claim as ${user}`
                          : "Create or connect account"}
                </Button>
            </CardContent>
        </Card>
    );
}
