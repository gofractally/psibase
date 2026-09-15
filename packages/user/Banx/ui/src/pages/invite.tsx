import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    AlarmClockMinus,
    LoaderCircle,
    TicketCheck,
    TriangleAlert,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";

import { ReciprocateLineForm } from "@/components/reciprocate-line-form";
import { useAssetMap } from "@/hooks/use-assets";
import { useCreditLines } from "@/hooks/use-banx-data";
import { displayAmount } from "@/lib/amount";
import { formatGracePeriod, ppmToPercent } from "@/lib/constants";
import { fetchInvite } from "@/lib/graphql";
import { inviteClaimedBy } from "@/lib/contacts";
import {
    forgetPendingReciprocal,
    importInviteToken,
    peekPendingReciprocal,
    rememberPendingReciprocal,
    rejectActiveInvite,
    type PendingReciprocal,
} from "@/lib/invite";

import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import QueryKey from "@shared/lib/query-keys";
import { Button } from "@shared/shadcn/ui/button";
import { toast } from "@shared/shadcn/ui/sonner";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

function termsFromInvite(row: {
    inviter: string;
    assetId: number;
    limit: string;
    depleteOnDebit: boolean;
    interestRatePpm: number;
    graceSeconds: number;
}): PendingReciprocal {
    return {
        inviter: row.inviter,
        assetId: row.assetId,
        limit: displayAmount(row.limit),
        depleteOnDebit: row.depleteOnDebit,
        interestRatePpm: row.interestRatePpm,
        graceSeconds: row.graceSeconds,
    };
}

export function InvitePage() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get("token");
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { data: user, isLoading: userLoading } = useCurrentUser();
    const { symbolOf } = useAssetMap();
    const { mutateAsync: connectAccount, isPending: connecting } =
        useConnectAccount();
    const { data: lines, isFetched: linesFetched } = useCreditLines();

    const [reciprocal, setReciprocal] = useState<PendingReciprocal | null>(
        () => (token ? null : peekPendingReciprocal()),
    );

    const imported = useQuery({
        enabled: !!token && !reciprocal,
        queryKey: ["banx", "importInvite", token],
        queryFn: () => importInviteToken(z.string().parse(token)),
        retry: false,
        staleTime: Infinity,
    });

    const inviteId = imported.data;
    const invite = useQuery({
        enabled: inviteId !== undefined && !reciprocal,
        queryKey: ["banx", "invite", inviteId],
        queryFn: () => fetchInvite(inviteId!),
        retry: false,
    });

    useEffect(() => {
        if (reciprocal || token) return;
        const stored = peekPendingReciprocal();
        if (stored) setReciprocal(stored);
    }, [reciprocal, token]);

    useEffect(() => {
        if (reciprocal || peekPendingReciprocal()) return;
        if (inviteId === undefined || invite.isLoading) return;
        const row = invite.data;
        if (invite.error || !row) {
            void rejectActiveInvite();
            return;
        }
        const expired = row.expiry > 0 && row.expiry * 1000 < Date.now();
        if (expired || inviteClaimedBy(row)) void rejectActiveInvite();
    }, [reciprocal, inviteId, invite.isLoading, invite.error, invite.data]);

    const alreadyLinedBack = useMemo(() => {
        if (!user || !reciprocal || !lines) return false;
        return lines.some(
            (l) =>
                l.creditor === user &&
                l.debtor === reciprocal.inviter &&
                l.assetId === reciprocal.assetId,
        );
    }, [user, reciprocal, lines]);

    const finishReciprocal = useCallback(() => {
        forgetPendingReciprocal();
        setReciprocal(null);
        navigate("/accounts", { replace: true });
    }, [navigate]);

    useEffect(() => {
        if (!reciprocal || userLoading) return;
        if (user && user === reciprocal.inviter) {
            finishReciprocal();
        }
    }, [reciprocal, user, userLoading, finishReciprocal]);

    const claim = async (row: NonNullable<typeof invite.data>) => {
        const terms = termsFromInvite(row);
        rememberPendingReciprocal(terms);
        try {
            await connectAccount({
                enabled: true,
                returnPath: "/invite",
            });
        } catch (e) {
            forgetPendingReciprocal();
            toast.error(
                e instanceof Error ? e.message : "Could not claim invite",
            );
            return;
        }
        setReciprocal(terms);
        await queryClient.invalidateQueries({
            queryKey: QueryKey.currentUser(),
        });
        navigate("/invite", { replace: true });
    };

    if (reciprocal) {
        const bouncing = user && user === reciprocal.inviter;
        if (
            userLoading ||
            bouncing ||
            (user && user !== reciprocal.inviter && !linesFetched)
        ) {
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
        return (
            <ReciprocateLineForm
                terms={reciprocal}
                skipLine={alreadyLinedBack}
                onDone={finishReciprocal}
            />
        );
    }

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

    const claimedBy = inviteClaimedBy(row);
    if (claimedBy) {
        return (
            <Card className="mx-auto mt-4 w-[350px]">
                <CardHeader>
                    <div className="mx-auto">
                        <TicketCheck className="h-12 w-12" />
                    </div>
                    <CardTitle>Invite already claimed</CardTitle>
                    <CardDescription>
                        This Banx invite was claimed by {claimedBy}. Ask the
                        sender for a new one if you still need a line.
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
                    . After you claim, you can nickname them (adds them to
                    Payees) and line them back — or skip. If you already have
                    an account, claiming applies the line to it (skipped if they
                    already lined you in {symbol}).
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
                    <dt>Deplete</dt>
                    <dd className="text-foreground text-right">
                        {row.depleteOnDebit ? "yes" : "no"}
                    </dd>
                </dl>
                <Button
                    className="w-full"
                    disabled={connecting}
                    onClick={() => void claim(row)}
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
