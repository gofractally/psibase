import * as React from "react";

import { PageHeading } from "@/components/page-heading";

import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Input } from "@shared/shadcn/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

import {
    useSetUsageQuota,
    useUsageQuotas,
    useUsageReport,
} from "../hooks/use-usage";
import { type UsageCountersType } from "../lib/usage";

const kinds = ["", "account", "ip", "peer", "local"];
const orders = [
    "units",
    "requests",
    "bytesIn",
    "bytesOut",
    "requestNs",
    "trxPushed",
    "trialNs",
    "compileNs",
    "verifyNs",
];
const quotaFields = ["requests", "bytesIn", "bytesOut", "trxPushed"] as const;

const formatBytes = (n: number): string => {
    if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(1) + " GiB";
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MiB";
    if (n >= 1024) return (n / 1024).toFixed(1) + " KiB";
    return n + " B";
};

const formatTime = (ns: number): string => {
    if (ns >= 1e9) return (ns / 1e9).toFixed(2) + " s";
    if (ns >= 1e6) return (ns / 1e6).toFixed(1) + " ms";
    return (ns / 1e3).toFixed(0) + " µs";
};

const formatSeen = (seconds: number, now: number): string => {
    const age = Math.max(0, now - seconds);
    if (age < 120) return age + " s ago";
    if (age < 7200) return Math.round(age / 60) + " min ago";
    if (age < 172800) return Math.round(age / 3600) + " h ago";
    return Math.round(age / 86400) + " d ago";
};

const nodeTime = (c: UsageCountersType): number =>
    c.requestNs + c.trialNs + c.compileNs + c.verifyNs + c.callbackNs;

const selectClass =
    "border-input bg-background h-9 rounded-md border px-2 text-sm";

export const UsagePage = () => {
    const [kind, setKind] = React.useState("");
    const [order, setOrder] = React.useState("units");
    const [recent, setRecent] = React.useState(false);
    const { data: report, error } = useUsageReport({
        kind: kind || undefined,
        order,
        recent,
        limit: 20,
    });
    const { data: quotas } = useUsageQuotas();
    const { mutate: setQuota, error: quotaError } = useSetUsageQuota();

    const [quotaIdentity, setQuotaIdentity] = React.useState("");
    const [quotaLimits, setQuotaLimits] = React.useState<
        Record<string, string>
    >({});

    const saveQuota = () => {
        const limits: Partial<UsageCountersType> = {};
        for (const field of quotaFields) {
            limits[field] = Number(quotaLimits[field] || 0);
        }
        setQuota({ identity: quotaIdentity.trim(), limits });
    };

    return (
        <div className="mx-auto w-full space-y-6">
            <PageHeading
                title="Usage"
                description="What each connection identity used of this node. Recorded locally; nothing is refused."
            />

            {error ? (
                <div className="text-destructive text-sm">
                    The usage report is not available: {String(error)}
                </div>
            ) : null}
            {report && !report.settings.enabled ? (
                <div className="text-muted-foreground text-sm">
                    Usage metering is off (usage-metering).
                </div>
            ) : null}

            <Card>
                <CardHeader>
                    <CardTitle>Totals</CardTitle>
                    <CardDescription>
                        Everything charged to each kind of identity, including
                        records that expired or were evicted.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Kind</TableHead>
                                <TableHead className="text-right">
                                    Identities
                                </TableHead>
                                <TableHead className="text-right">
                                    Requests
                                </TableHead>
                                <TableHead className="text-right">In</TableHead>
                                <TableHead className="text-right">
                                    Out
                                </TableHead>
                                <TableHead className="text-right">
                                    Transactions
                                </TableHead>
                                <TableHead className="text-right">
                                    Node time
                                </TableHead>
                                <TableHead className="text-right">
                                    Recent node time
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {report?.totals.map((item) => (
                                <TableRow key={item.kind}>
                                    <TableCell className="font-mono">
                                        {item.kind}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {item.records}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {item.total.requests}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {formatBytes(item.total.bytesIn)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {formatBytes(item.total.bytesOut)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {item.total.trxPushed}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {formatTime(nodeTime(item.total))}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {formatTime(nodeTime(item.recent))}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Top consumers</CardTitle>
                    <CardDescription>
                        The 20 identities that used the most, in total or in
                        the current and previous window.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                        <label className="flex items-center gap-2">
                            Kind
                            <select
                                className={selectClass}
                                value={kind}
                                onChange={(e) => setKind(e.target.value)}
                            >
                                {kinds.map((k) => (
                                    <option key={k} value={k}>
                                        {k || "all"}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="flex items-center gap-2">
                            Order by
                            <select
                                className={selectClass}
                                value={order}
                                onChange={(e) => setOrder(e.target.value)}
                            >
                                {orders.map((o) => (
                                    <option key={o} value={o}>
                                        {o}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={recent}
                                onChange={(e) => setRecent(e.target.checked)}
                            />
                            Recent use
                        </label>
                    </div>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Identity</TableHead>
                                <TableHead className="text-right">
                                    Requests
                                </TableHead>
                                <TableHead className="text-right">In</TableHead>
                                <TableHead className="text-right">
                                    Out
                                </TableHead>
                                <TableHead className="text-right">
                                    Transactions
                                </TableHead>
                                <TableHead className="text-right">
                                    Node time
                                </TableHead>
                                <TableHead className="text-right">
                                    Last seen
                                </TableHead>
                                <TableHead className="text-right">
                                    Quota (requests)
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {report?.top.map((record) => {
                                const c = recent ? record.recent : record.total;
                                return (
                                    <TableRow
                                        key={record.identity}
                                        className="cursor-pointer"
                                        onClick={() =>
                                            setQuotaIdentity(record.identity)
                                        }
                                    >
                                        <TableCell className="font-mono">
                                            {record.identity}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {c.requests}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatBytes(c.bytesIn)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatBytes(c.bytesOut)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {c.trxPushed}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatTime(nodeTime(c))}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatSeen(
                                                record.lastSeen,
                                                report.now,
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {record.quota?.requests || "-"}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Quotas</CardTitle>
                    <CardDescription>
                        Limits per usage window for one identity
                        (account:alice) or for every identity of a kind
                        (ip:*). Stored only: nothing enforces a quota yet. A
                        quota with every limit 0 is removed.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-end gap-3">
                        <label className="text-sm">
                            Identity
                            <Input
                                className="w-64 font-mono"
                                placeholder="account:alice"
                                value={quotaIdentity}
                                onChange={(e) =>
                                    setQuotaIdentity(e.target.value)
                                }
                            />
                        </label>
                        {quotaFields.map((field) => (
                            <label key={field} className="text-sm">
                                {field}
                                <Input
                                    className="w-32"
                                    type="number"
                                    min={0}
                                    placeholder="0"
                                    value={quotaLimits[field] ?? ""}
                                    onChange={(e) =>
                                        setQuotaLimits({
                                            ...quotaLimits,
                                            [field]: e.target.value,
                                        })
                                    }
                                />
                            </label>
                        ))}
                        <Button onClick={saveQuota} disabled={!quotaIdentity}>
                            Save
                        </Button>
                    </div>
                    {quotaError ? (
                        <div className="text-destructive text-sm">
                            {String(quotaError)}
                        </div>
                    ) : null}
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Identity</TableHead>
                                {quotaFields.map((field) => (
                                    <TableHead
                                        key={field}
                                        className="text-right"
                                    >
                                        {field}
                                    </TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {quotas?.map((quota) => (
                                <TableRow
                                    key={quota.identity}
                                    className="cursor-pointer"
                                    onClick={() => {
                                        setQuotaIdentity(quota.identity);
                                        const limits: Record<string, string> =
                                            {};
                                        for (const field of quotaFields) {
                                            limits[field] = String(
                                                quota.perWindow[field],
                                            );
                                        }
                                        setQuotaLimits(limits);
                                    }}
                                >
                                    <TableCell className="font-mono">
                                        {quota.identity}
                                    </TableCell>
                                    {quotaFields.map((field) => (
                                        <TableCell
                                            key={field}
                                            className="text-right"
                                        >
                                            {quota.perWindow[field] || "-"}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
};
