import { Link } from "react-router-dom";

import { PageHeader } from "@/components/page-header";
import { useAssetMap } from "@/hooks/use-assets";
import {
    useCreditLines,
    useObligations,
} from "@/hooks/use-banx-data";
import { formatRawAmount } from "@/lib/amount";
import { ppmToPercent } from "@/lib/constants";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

export function Dashboard() {
    const { data: user } = useCurrentUser();
    const { data: lines = [], isLoading: linesLoading } = useCreditLines();
    const { data: obs = [], isLoading: obsLoading } = useObligations();
    const { symbolOf, precisionOf } = useAssetMap();

    const asCreditor = lines.filter((l) => l.creditor === user);
    const asDebtor = lines.filter((l) => l.debtor === user);
    const owedToMe = obs.filter((o) => o.creditor === user);
    const iOwe = obs.filter((o) => o.debtor === user);

    return (
        <div>
            <PageHeader
                title="Banx"
                description={`Signed in as ${user}. Mutual credit: lines, deposits, path pay, convert.`}
            />

            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                    title="Lines you offer"
                    value={String(asCreditor.length)}
                    loading={linesLoading}
                />
                <Stat
                    title="Lines to you"
                    value={String(asDebtor.length)}
                    loading={linesLoading}
                />
                <Stat
                    title="Claims you hold"
                    value={String(owedToMe.length)}
                    loading={obsLoading}
                />
                <Stat
                    title="Claims against you"
                    value={String(iOwe.length)}
                    loading={obsLoading}
                />
            </div>

            <div className="mb-8 flex flex-wrap gap-2">
                <Button asChild variant="default">
                    <Link to="/obligations">Accounts</Link>
                </Button>
                <Button asChild variant="outline">
                    <Link to="/path-pay">Path pay</Link>
                </Button>
                <Button asChild variant="outline">
                    <Link to="/policies">Policies</Link>
                </Button>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">
                            Savings &amp; deposits
                        </CardTitle>
                        <CardDescription>
                            Claims you hold — like deposit balances others owe you
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        {owedToMe.length === 0 ? (
                            <p className="text-muted-foreground">None yet</p>
                        ) : (
                            owedToMe.slice(0, 8).map((o) => (
                                <div
                                    key={o.id}
                                    className="flex justify-between gap-2 border-b py-1 last:border-0"
                                >
                                    <span>
                                        {o.debtor} · {symbolOf(o.assetId)} ·{" "}
                                        {ppmToPercent(o.interestRatePpm)}
                                    </span>
                                    <span className="font-mono tabular-nums">
                                        {formatRawAmount(
                                            o.remainingPrincipal,
                                            precisionOf(o.assetId),
                                        )}{" "}
                                        +{" "}
                                        {formatRawAmount(
                                            o.accruedInterest,
                                            precisionOf(o.assetId),
                                        )}
                                    </span>
                                </div>
                            ))
                        )}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">
                            Loans &amp; liabilities
                        </CardTitle>
                        <CardDescription>
                            What you owe others — home-loan style balances
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        {iOwe.length === 0 ? (
                            <p className="text-muted-foreground">None yet</p>
                        ) : (
                            iOwe.slice(0, 8).map((o) => (
                                <div
                                    key={o.id}
                                    className="flex justify-between gap-2 border-b py-1 last:border-0"
                                >
                                    <span>
                                        {o.creditor} · {symbolOf(o.assetId)} ·{" "}
                                        {ppmToPercent(o.interestRatePpm)}
                                    </span>
                                    <span className="font-mono tabular-nums">
                                        {formatRawAmount(
                                            o.remainingPrincipal,
                                            precisionOf(o.assetId),
                                        )}{" "}
                                        +{" "}
                                        {formatRawAmount(
                                            o.accruedInterest,
                                            precisionOf(o.assetId),
                                        )}
                                    </span>
                                </div>
                            ))
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

function Stat({
    title,
    value,
    loading,
}: {
    title: string;
    value: string;
    loading?: boolean;
}) {
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardDescription>{title}</CardDescription>
                <CardTitle className="text-3xl tabular-nums">
                    {loading ? "…" : value}
                </CardTitle>
            </CardHeader>
        </Card>
    );
}
