import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { formatNumber } from "@/lib/format";
import { fetchInstalledPackages } from "@/lib/queries";
import { useChainStats } from "@/store/use-live-chain";

import { AccountLink } from "@/components/account-link";
import { ServiceActivityChart } from "@/components/charts/service-activity-chart";
import { PageHeader, Panel } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";

import { Badge } from "@shared/shadcn/ui/badge";
import { Input } from "@shared/shadcn/ui/input";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const ServicesPage = () => {
    const [params, setParams] = useSearchParams();
    const q = params.get("q") ?? "";
    const stats = useChainStats();

    const packages = useQuery({
        queryKey: ["packages", "installed"],
        queryFn: fetchInstalledPackages,
        staleTime: 5 * 60_000,
    });

    const activity = useMemo(
        () => new Map(stats.serviceActivity.map((s) => [s.service, s.count])),
        [stats.serviceActivity],
    );

    const rows = useMemo(() => {
        const list = packages.data ?? [];
        const lower = q.trim().toLowerCase();
        return list
            .filter(
                (p) =>
                    !lower ||
                    p.name.toLowerCase().includes(lower) ||
                    p.description.toLowerCase().includes(lower) ||
                    p.accounts.some((a) => a.includes(lower)) ||
                    p.owner.includes(lower),
            )
            .map((p) => ({
                ...p,
                activity: p.accounts.reduce((n, a) => n + (activity.get(a) ?? 0), 0),
            }))
            .sort((a, b) => b.activity - a.activity || a.name.localeCompare(b.name));
    }, [packages.data, q, activity]);

    const totalServices = new Set((packages.data ?? []).flatMap((p) => p.services)).size;
    const totalAccounts = new Set((packages.data ?? []).flatMap((p) => p.accounts)).size;
    const owners = new Set((packages.data ?? []).map((p) => p.owner)).size;

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                title="Services & packages"
                description="Everything installed on the chain, ranked by live activity"
                actions={
                    <Input
                        value={q}
                        onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {})}
                        placeholder="Filter packages, services, owners"
                        className="h-8 w-64 text-xs"
                    />
                }
            />

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard
                    label="Packages"
                    icon={Package}
                    accent="var(--chart-4)"
                    value={packages.data ? formatNumber(packages.data.length) : "—"}
                    sub={`${owners} owner${owners === 1 ? "" : "s"}`}
                />
                <StatCard
                    label="Services"
                    accent="var(--chart-2)"
                    value={packages.data ? formatNumber(totalServices) : "—"}
                    sub={`${formatNumber(totalAccounts)} accounts total`}
                />
                <StatCard
                    label="Active services"
                    accent="var(--chart-1)"
                    value={formatNumber(stats.serviceActivity.length)}
                    sub="received user actions in window"
                />
                <StatCard
                    label="Actions"
                    accent="var(--chart-5)"
                    value={formatNumber(stats.actionCount)}
                    sub={`across ${formatNumber(stats.windowBlocks)} blocks`}
                />
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
                <Panel title="Activity by service" bodyClassName="p-4">
                    <ServiceActivityChart data={stats.serviceActivity} height={180} />
                </Panel>

                <Panel
                    title={`Installed packages (${rows.length})`}
                    className="xl:col-span-2"
                >
                    {packages.isPending ? (
                        <div className="flex flex-col gap-2 p-4">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <Skeleton key={i} className="h-7" />
                            ))}
                        </div>
                    ) : packages.isError ? (
                        <div className="text-destructive p-4 text-sm">{(packages.error as Error).message}</div>
                    ) : (
                        <div className="scrollbar-thin max-h-[720px] overflow-auto">
                            <table className="w-full text-[13px]">
                                <thead className="bg-muted/30 sticky top-0 border-b backdrop-blur">
                                    <tr className="text-muted-foreground text-left text-[11px] tracking-wider uppercase">
                                        <th className="h-8 px-3 font-medium">Package</th>
                                        <th className="h-8 px-3 font-medium">Accounts</th>
                                        <th className="h-8 px-3 font-medium">Owner</th>
                                        <th className="h-8 px-3 text-right font-medium">Activity</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((p) => (
                                        <tr key={`${p.owner}/${p.name}`} className="hover:bg-accent/40 border-b align-top last:border-b-0">
                                            <td className="max-w-[320px] px-3 py-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium">{p.name}</span>
                                                    <Badge variant="outline" className="h-4 px-1 font-mono text-[9px]">
                                                        {p.version}
                                                    </Badge>
                                                </div>
                                                {p.description && (
                                                    <div className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                                                        {p.description}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-3 py-2">
                                                <div className="flex flex-wrap gap-x-3 gap-y-1">
                                                    {p.accounts.map((a) => (
                                                        <span key={a} className="inline-flex items-center gap-1">
                                                            <AccountLink name={a} />
                                                            {p.services.includes(a) && (
                                                                <span className="text-muted-foreground text-[9px] uppercase">svc</span>
                                                            )}
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2">
                                                <AccountLink name={p.owner} dot={false} />
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                                                {p.activity ? (
                                                    <span className="text-foreground">{formatNumber(p.activity)}</span>
                                                ) : (
                                                    <span className="text-muted-foreground/50">0</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {rows.length === 0 && (
                                        <tr>
                                            <td colSpan={4} className="text-muted-foreground px-3 py-8 text-center text-sm">
                                                No packages match “{q}”
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Panel>
            </div>
        </div>
    );
};
