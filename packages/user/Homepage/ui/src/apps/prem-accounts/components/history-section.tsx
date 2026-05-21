import { useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";

import { NameEvent } from "@/apps/prem-accounts/lib/graphql/prem-accounts.schemas";

import { Loading } from "@/components/loading";

import { DataTable } from "@shared/components/data-table";
import { ErrorCard } from "@shared/components/error-card";
import { GlowingCard } from "@shared/components/glowing-card";
import {
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

type Props = {
    events: NameEvent[];
    isPending: boolean;
    isError: boolean;
    error: Error | null;
    isLoggedIn: boolean;
};

export function HistorySection({
    events,
    isPending,
    isError,
    error,
    isLoggedIn,
}: Props) {
    const columns = useMemo<ColumnDef<NameEvent>[]>(
        () => [
            {
                accessorKey: "account",
                header: "Account",
                cell: ({ row }) => (
                    <span className="font-mono">{row.original.account}</span>
                ),
            },
            {
                accessorKey: "action",
                header: "Event",
                cell: ({ row }) => (
                    <span className="capitalize">{row.original.action}</span>
                ),
            },
        ],
        [],
    );

    if (!isLoggedIn) {
        return (
            <GlowingCard>
                <CardContent className="text-muted-foreground py-8 text-center">
                    Log in to see your premium account history.
                </CardContent>
            </GlowingCard>
        );
    }

    if (isPending) {
        return (
            <GlowingCard>
                <Loading />
            </GlowingCard>
        );
    }

    if (isError) {
        return (
            <GlowingCard>
                <ErrorCard
                    error={
                        error ?? new Error("Failed to load account history.")
                    }
                />
            </GlowingCard>
        );
    }

    if (events.length === 0) {
        return (
            <GlowingCard>
                <CardHeader>
                    <CardTitle>History</CardTitle>
                    <CardDescription>
                        Purchases and claims appear here.
                    </CardDescription>
                </CardHeader>
                <CardContent className="text-muted-foreground py-8 text-center">
                    You don&apos;t have any history yet.
                </CardContent>
            </GlowingCard>
        );
    }

    return (
        <GlowingCard>
            <CardHeader>
                <CardTitle>History</CardTitle>
                <CardDescription>
                    Purchases and claims for your account.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <DataTable
                    columns={columns}
                    data={events}
                    pageSize={10}
                    caption="Your premium account activity."
                    emptyMessage="You don't have any history yet."
                />
            </CardContent>
        </GlowingCard>
    );
}
