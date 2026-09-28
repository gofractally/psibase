import { Package } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ClaimNameDialog } from "@/apps/accounts-marketplace/components/claim-name-dialog";
import { ACCOUNT_MARKETPLACE_PATH } from "@/apps/accounts-marketplace/route";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/page-header";
import { DataTable, THead, Table, Td, Th, Tr } from "@/components/table";

import { Button } from "@shared/shadcn/ui/button";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

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

    return (
        <>
            <Panel
                title="Unclaimed names"
                description={
                    names.length
                        ? `${names.length} purchased name${names.length === 1 ? "" : "s"} waiting to be claimed`
                        : "Claim purchased names to activate them on this network"
                }
                className="max-w-3xl"
            >
                {isPending ? (
                    <div className="flex flex-col gap-2 p-4">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <Skeleton key={i} className="h-6 w-full" />
                        ))}
                    </div>
                ) : isError ? (
                    <EmptyState
                        className="text-destructive min-h-24"
                        detail={error?.message}
                    >
                        Failed to load unclaimed names
                    </EmptyState>
                ) : names.length === 0 ? (
                    <EmptyState
                        icon={Package}
                        className="min-h-40"
                        detail="Names you buy show up here until you claim them and set a key."
                        action={
                            <Button
                                asChild
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                            >
                                <Link to={`/${ACCOUNT_MARKETPLACE_PATH}`}>
                                    Buy a name
                                </Link>
                            </Button>
                        }
                    >
                        Nothing to claim
                    </EmptyState>
                ) : (
                    <DataTable>
                        <Table>
                            <THead>
                                <tr>
                                    <Th>Account</Th>
                                    <Th className="text-right">Action</Th>
                                </tr>
                            </THead>
                            <tbody>
                                {names.map((account) => (
                                    <Tr key={account}>
                                        <Td>
                                            <span className="font-mono font-medium">
                                                {account}
                                            </span>
                                        </Td>
                                        <Td className="text-right">
                                            <Button
                                                type="button"
                                                size="xs"
                                                onClick={() =>
                                                    setAccountToClaim(account)
                                                }
                                            >
                                                Claim
                                            </Button>
                                        </Td>
                                    </Tr>
                                ))}
                            </tbody>
                        </Table>
                    </DataTable>
                )}
            </Panel>
            <ClaimNameDialog
                account={accountToClaim ?? ""}
                open={accountToClaim !== null}
                onClose={() => setAccountToClaim(null)}
            />
        </>
    );
}
