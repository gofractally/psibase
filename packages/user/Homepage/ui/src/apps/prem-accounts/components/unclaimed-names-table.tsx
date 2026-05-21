import { useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";

import { useClaimName } from "@/apps/prem-accounts/hooks/use-claim-name";

import { Loading } from "@/components/loading";

import { DataTable } from "@shared/components/data-table";
import { ErrorCard } from "@shared/components/error-card";
import { GlowingCard } from "@shared/components/glowing-card";
import { Button } from "@shared/shadcn/ui/button";
import {
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

type UnclaimedNameRow = {
    account: string;
};

type Props = {
    names: string[];
    isPending: boolean;
    isError: boolean;
    error: Error | null;
};

export function UnclaimedNamesTable({
    names,
    isPending,
    isError,
    error,
}: Props) {
    const { mutateAsync: claimName, isPending: isClaimPending, variables } =
        useClaimName();

    const data = useMemo(
        () => names.map((account) => ({ account })),
        [names],
    );

    const columns = useMemo<ColumnDef<UnclaimedNameRow>[]>(
        () => [
            {
                accessorKey: "account",
                header: "Account",
                cell: ({ row }) => (
                    <span className="font-mono">{row.original.account}</span>
                ),
            },
            {
                id: "actions",
                header: () => <div className="text-right">Action</div>,
                cell: ({ row }) => {
                    const name = row.original.account;
                    const isClaiming =
                        isClaimPending && variables === name;

                    return (
                        <div className="text-right">
                            <Button
                                type="button"
                                size="sm"
                                disabled={isClaiming}
                                onClick={() => {
                                    void claimName(name);
                                }}
                            >
                                {isClaiming ? "Claiming..." : "Claim"}
                            </Button>
                        </div>
                    );
                },
            },
        ],
        [claimName, isClaimPending, variables],
    );

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
                        error ??
                        new Error("Failed to load unclaimed names.")
                    }
                />
            </GlowingCard>
        );
    }

    if (names.length === 0) {
        return (
            <GlowingCard>
                <CardContent className="text-muted-foreground py-8 text-center">
                    You have no purchased accounts waiting to be claimed.
                </CardContent>
            </GlowingCard>
        );
    }

    return (
        <GlowingCard>
            <CardHeader>
                <CardTitle>Unclaimed names</CardTitle>
                <CardDescription>
                    Claim purchased names to activate them on this chain.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <DataTable
                    columns={columns}
                    data={data}
                    pageSize={10}
                    caption="Purchased names awaiting claim."
                    emptyMessage="You have no purchased accounts waiting to be claimed."
                />
            </CardContent>
        </GlowingCard>
    );
}
