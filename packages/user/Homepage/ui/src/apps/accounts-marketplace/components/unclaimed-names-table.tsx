import { type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";

import { ClaimNameDialog } from "@/apps/accounts-marketplace/components/claim-name-dialog";

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
    const [accountToClaim, setAccountToClaim] = useState<string | null>(null);

    const data = useMemo(() => names.map((account) => ({ account })), [names]);

    const columns = useMemo<ColumnDef<UnclaimedNameRow>[]>(
        () => [
            {
                accessorKey: "account",
                header: "Account",
                cell: ({ row }) => (
                    <span className="font-mono text-sm font-medium">
                        {row.original.account}
                    </span>
                ),
            },
            {
                id: "actions",
                header: () => <div className="text-right">Action</div>,
                meta: { className: "w-[1%] whitespace-nowrap pl-3" },
                cell: ({ row }) => (
                    <div className="flex justify-end">
                        <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() =>
                                setAccountToClaim(row.original.account)
                            }
                        >
                            Claim
                        </Button>
                    </div>
                ),
            },
        ],
        [],
    );

    const claimDialog = (
        <ClaimNameDialog
            account={accountToClaim ?? ""}
            open={accountToClaim !== null}
            onClose={() => setAccountToClaim(null)}
        />
    );

    if (isPending) {
        return (
            <>
                <GlowingCard>
                    <Loading />
                </GlowingCard>
                {claimDialog}
            </>
        );
    }

    if (isError) {
        return (
            <>
                <GlowingCard>
                    <ErrorCard
                        error={
                            error ??
                            new Error("Failed to load unclaimed names.")
                        }
                    />
                </GlowingCard>
                {claimDialog}
            </>
        );
    }

    if (names.length === 0) {
        return (
            <>
                <GlowingCard>
                    <CardContent className="text-muted-foreground py-8 text-center">
                        You have no purchased accounts waiting to be claimed.
                    </CardContent>
                </GlowingCard>
                {claimDialog}
            </>
        );
    }

    return (
        <>
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
            {claimDialog}
        </>
    );
}
