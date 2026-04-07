import { useEffect, useState } from "react";

import { siblingUrl } from "@psibase/common-lib";

import {
    PREM_ACCOUNTS_SERVICE,
    zPremiumAccountName,
} from "@/lib/prem-service";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { supervisor } from "@shared/lib/supervisor";
import { Button } from "@shared/shadcn/ui/button";

export function PurchasedPage() {
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

    const loadBoughtNames = async () => {
        if (!loggedInUser) return;

        setIsLoadingNames(true);
        try {
            const premAccountsGraphqlUrl = siblingUrl(
                null,
                PREM_ACCOUNTS_SERVICE,
                "/graphql",
            );
            const response = await fetch(premAccountsGraphqlUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    query: `
                        query {
                            unclaimedNames
                        }
                    `,
                }),
            });
            const data = (await response.json()) as {
                data?: {
                    unclaimedNames?: string[];
                };
                errors?: Array<{ message: string }>;
            };
            if (data.errors) {
                throw new Error(data.errors[0].message);
            }
            setBoughtNames(data.data?.unclaimedNames ?? []);
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

        const zod = zPremiumAccountName.safeParse(name.trim());
        if (!zod.success) {
            setError(
                zod.error.issues[0]?.message ?? "Invalid account name",
            );
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
                {isLoadingNames ? (
                    <p className="text-gray-500">
                        Loading your purchased names...
                    </p>
                ) : boughtNames.length === 0 ? (
                    <p className="text-gray-500">
                        You have no purchased accounts that haven&apos;t yet
                        been claimed.
                    </p>
                ) : (
                    <ul className="space-y-2">
                        {boughtNames.map((name) => (
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
                                    disabled={claimingNames.has(name)}
                                    onClick={() => void handleClaim(name)}
                                >
                                    {claimingNames.has(name)
                                        ? "Claiming..."
                                        : "Claim"}
                                </Button>
                            </li>
                        ))}
                    </ul>
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
                            {claimSuccessNotification.privateKey}
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
