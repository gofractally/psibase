import type { PremAccountsOutletContext } from "@/components/prem-accounts-main";
import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";

import { zUnclaimedNamesPageData } from "@/lib/graphql/prem-accounts.schemas";
import { PREM_ACCOUNTS_SERVICE } from "@/lib/prem-service";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { pemToB64 } from "@shared/lib/b64-key-utils";
import { graphql } from "@shared/lib/graphql";
import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";
import { Button } from "@shared/shadcn/ui/button";

const PAGE_SIZE = 10;
const FETCH_BATCH_SIZE = 50;

export function PurchasedPage() {
    const { bumpHistory } = useOutletContext<PremAccountsOutletContext>();
    const { data: loggedInUser } = useCurrentUser();
    const [boughtNames, setBoughtNames] = useState<string[]>([]);
    const [isLoadingNames, setIsLoadingNames] = useState(false);
    const [claimingNames, setClaimingNames] = useState<Set<string>>(new Set());
    const [error, setError] = useState("");
    const [claimSuccessMessage, setClaimSuccessMessage] = useState("");
    const [claimSuccessNotification, setClaimSuccessNotification] = useState<{
        accountName: string;
        privateKey: string;
    } | null>(null);
    const [currentPage, setCurrentPage] = useState(1);

    const loadBoughtNames = async () => {
        if (!loggedInUser) return;

        setIsLoadingNames(true);
        try {
            const allNames: string[] = [];
            let hasNextPage = true;
            let cursorArg = "";

            while (hasNextPage) {
                const page = zUnclaimedNamesPageData.parse(
                    await graphql(
                        `
                            {
                                unclaimedNames(
                                    first: ${FETCH_BATCH_SIZE}${cursorArg}
                                ) {
                                    edges {
                                        node {
                                            account
                                        }
                                    }
                                    pageInfo {
                                        hasNextPage
                                        endCursor
                                    }
                                }
                            }
                        `,
                        {
                            service: PREM_ACCOUNTS_SERVICE,
                        },
                    ),
                );
                const connection = page.unclaimedNames;
                if (!connection) {
                    break;
                }

                for (const edge of connection.edges) {
                    const node = edge.node;
                    if (node) {
                        allNames.push(node.account);
                    }
                }

                hasNextPage = connection.pageInfo?.hasNextPage ?? false;
                const endCursor = connection.pageInfo?.endCursor;
                cursorArg = endCursor ? `, after: "${endCursor}"` : "";
            }

            setBoughtNames(allNames);
            setCurrentPage((p) => {
                const totalPages = Math.max(
                    1,
                    Math.ceil(allNames.length / PAGE_SIZE),
                );
                return Math.min(Math.max(1, p), totalPages);
            });
        } catch (e) {
            console.error("Failed to load bought names:", e);
            setBoughtNames([]);
        } finally {
            setIsLoadingNames(false);
        }
    };

    useEffect(() => {
        if (loggedInUser) {
            void loadBoughtNames();
        } else {
            setBoughtNames([]);
            setCurrentPage(1);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loggedInUser]);

    const handleClaim = async (name: string) => {
        if (claimingNames.has(name)) {
            return;
        }

        setClaimingNames((prev) => new Set(prev).add(name));
        setError("");
        setClaimSuccessMessage("");
        setClaimSuccessNotification(null);

        const zod = zAccount.safeParse(name.trim());
        if (!zod.success) {
            setError(zod.error.issues[0]?.message ?? "Invalid account name");
            setClaimingNames((prev) => {
                const next = new Set(prev);
                next.delete(name);
                return next;
            });
            return;
        }

        try {
            const privateKey = (await supervisor.functionCall({
                service: PREM_ACCOUNTS_SERVICE,
                plugin: "plugin",
                intf: "api",
                method: "claim",
                params: [name.trim()],
            })) as string;

            setClaimSuccessMessage(`Account '${name}' claimed successfully`);
            setClaimSuccessNotification({ accountName: name, privateKey });

            await loadBoughtNames();
            bumpHistory();

            setTimeout(() => setClaimSuccessMessage(""), 5000);
        } catch (e) {
            if (e instanceof Error) {
                setError(e.message);
            } else {
                setError(`Failed to claim account ${name}`);
            }
        } finally {
            setClaimingNames((prev) => {
                const next = new Set(prev);
                next.delete(name);
                return next;
            });
        }
    };

    return (
        <div className="mt-2">
            <h1 className="mb-6 text-2xl font-semibold">Purchased names</h1>
            <div>
                {isLoadingNames && boughtNames.length === 0 ? (
                    <p className="text-gray-500">
                        Loading your purchased names...
                    </p>
                ) : boughtNames.length === 0 ? (
                    <p className="text-gray-500">
                        You have no purchased accounts that haven&apos;t yet
                        been claimed.
                    </p>
                ) : (
                    (() => {
                        const totalPages = Math.ceil(
                            boughtNames.length / PAGE_SIZE,
                        );
                        const pageNames = boughtNames.slice(
                            (currentPage - 1) * PAGE_SIZE,
                            currentPage * PAGE_SIZE,
                        );
                        return (
                            <div className="space-y-3">
                                {totalPages > 1 && (
                                    <div className="flex items-center justify-between text-sm">
                                        <button
                                            onClick={() =>
                                                setCurrentPage((p: number) =>
                                                    Math.max(1, p - 1),
                                                )
                                            }
                                            disabled={currentPage === 1}
                                            className="enabled:hover:bg-muted rounded-md border px-3 py-1 disabled:opacity-40"
                                        >
                                            Previous
                                        </button>
                                        <span className="text-muted-foreground">
                                            Page {currentPage} of {totalPages}
                                        </span>
                                        <button
                                            onClick={() =>
                                                setCurrentPage((p: number) =>
                                                    Math.min(
                                                        totalPages,
                                                        p + 1,
                                                    ),
                                                )
                                            }
                                            disabled={
                                                currentPage === totalPages
                                            }
                                            className="enabled:hover:bg-muted rounded-md border px-3 py-1 disabled:opacity-40"
                                        >
                                            Next
                                        </button>
                                    </div>
                                )}
                                <ul className="space-y-2">
                                    {pageNames.map((name) => (
                                        <li
                                            key={name}
                                            className="flex items-center justify-between border-b pb-2"
                                        >
                                            <span className="font-mono text-base">
                                                {name}
                                            </span>
                                            <Button
                                                type="button"
                                                size="sm"
                                                disabled={claimingNames.has(
                                                    name,
                                                )}
                                                onClick={() =>
                                                    void handleClaim(name)
                                                }
                                            >
                                                {claimingNames.has(name)
                                                    ? "Claiming..."
                                                    : "Claim"}
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        );
                    })()
                )}
                <div className="mt-4 flex min-h-[2.5rem] items-center">
                    {claimSuccessMessage && (
                        <p className="font-medium text-green-600">
                            {claimSuccessMessage}
                        </p>
                    )}
                    {error && <p className="text-red-500">{error}</p>}
                </div>
                {claimSuccessNotification && (
                    <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/50">
                        <p className="mb-2 font-medium text-green-700 dark:text-green-300">
                            Account &apos;{claimSuccessNotification.accountName}
                            &apos; claimed successfully
                        </p>
                        <p className="text-muted-foreground mb-1 text-sm">
                            Private key (save this securely):
                        </p>
                        <p className="bg-muted/80 mb-4 break-all rounded p-2 font-mono text-sm">
                            {pemToB64(claimSuccessNotification.privateKey)}
                        </p>
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => setClaimSuccessNotification(null)}
                        >
                            Ok
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
