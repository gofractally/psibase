import * as React from "react";
import { Label, Pie, PieChart } from "recharts";

import { PageHeading } from "@/components/page-heading";

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from "@shared/shadcn/ui/chart";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { usePerformance } from "../hooks/use-performance";
import { useTransactStats } from "../hooks/use-transact-stats";

const chartConfig = {
    database: {
        label: "Database",
        color: "var(--chart-1)",
    },
    code: {
        label: "Code",
        color: "var(--chart-2)",
    },
    data: {
        label: "Data",
        color: "var(--chart-5)",
    },
    wasmMemory: {
        label: "WASM Memory",
        color: "var(--chart-3)",
    },
    wasmCode: {
        label: "WASM Code",
        color: "var(--chart-4)",
    },
    unclassified: {
        label: "Unclassified",
        color: "var(--chart-5)",
    },
} satisfies ChartConfig;

const bytesToMb = (bytes: number): number => Math.ceil(bytes / 1024 / 1024);

const Stat = ({
    label,
    value,
}: {
    label: string;
    value: number | undefined;
}) => (
    <div className="bg-muted/40 rounded-lg border p-4">
        <div className="text-muted-foreground text-xs">{label}</div>
        <div className="mt-1 flex items-baseline gap-1.5 text-2xl font-semibold tabular-nums">
            {value ?? "—"}
            <span className="text-muted-foreground text-sm font-normal">
                transactions
            </span>
        </div>
    </div>
);

export function DashboardPage() {
    const { data, isPending: isLoadingPerf } = usePerformance();
    const { data: txStats, isPending: isLoadingTx } = useTransactStats();

    const chartData = React.useMemo(
        () => [
            {
                memType: "database",
                usage: bytesToMb(data?.memory.database || 0),
                fill: "var(--color-database)",
            },
            {
                memType: "code",
                usage: bytesToMb(data?.memory.code || 0),
                fill: "var(--color-code)",
            },
            {
                memType: "data",
                usage: bytesToMb(data?.memory.data || 0),
                fill: "var(--color-data)",
            },
            {
                memType: "wasmMemory",
                usage: bytesToMb(data?.memory.wasmMemory || 0),
                fill: "var(--color-wasmMemory)",
            },
            {
                memType: "wasmCode",
                usage: bytesToMb(data?.memory.wasmCode || 0),
                fill: "var(--color-wasmCode)",
            },
            {
                memType: "unclassified",
                usage: bytesToMb(data?.memory.unclassified || 0),
                fill: "var(--color-unclassified)",
            },
        ],
        [data],
    );

    const totalMb = React.useMemo(
        () => chartData.reduce((acc, curr) => acc + curr.usage, 0),
        [chartData],
    );

    if (isLoadingPerf && isLoadingTx) {
        return (
            <div>
                <PageHeading
                    title="Dashboard"
                    description="Node memory use and transaction activity."
                />
                <div className="grid gap-4 lg:grid-cols-2">
                    <Skeleton className="h-80" />
                    <Skeleton className="h-80" />
                </div>
            </div>
        );
    }

    return (
        <div>
            <PageHeading
                title="Dashboard"
                description="Node memory use and transaction activity."
            />
            <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>RAM usage</CardTitle>
                        <CardDescription>
                            Memory consumed by this node process.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-center justify-center">
                        <ChartContainer
                            config={chartConfig}
                            className="aspect-square h-[250px] w-[250px]"
                        >
                            <PieChart>
                                <ChartTooltip
                                    content={
                                        <ChartTooltipContent
                                            hideLabel
                                            indicator="dashed"
                                        />
                                    }
                                />
                                <Pie
                                    data={chartData}
                                    dataKey="usage"
                                    nameKey="memType"
                                    innerRadius={60}
                                    strokeWidth={5}
                                >
                                    <Label
                                        content={({ viewBox }) => {
                                            if (
                                                viewBox &&
                                                "cx" in viewBox &&
                                                "cy" in viewBox
                                            ) {
                                                return (
                                                    <text
                                                        x={viewBox.cx}
                                                        y={viewBox.cy}
                                                        textAnchor="middle"
                                                        dominantBaseline="middle"
                                                    >
                                                        <tspan
                                                            x={viewBox.cx}
                                                            y={viewBox.cy}
                                                            className="fill-foreground text-3xl font-bold"
                                                        >
                                                            {totalMb.toLocaleString()}
                                                        </tspan>
                                                        <tspan
                                                            x={viewBox.cx}
                                                            y={
                                                                (viewBox.cy ||
                                                                    0) + 24
                                                            }
                                                            className="fill-muted-foreground"
                                                        >
                                                            MB
                                                        </tspan>
                                                    </text>
                                                );
                                            }
                                        }}
                                    />
                                </Pie>
                            </PieChart>
                        </ChartContainer>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>Transactions</CardTitle>
                        <CardDescription>
                            Counts reported by the transact service.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-3">
                        <Stat label="Succeeded" value={txStats?.succeeded} />
                        <Stat label="Failed" value={txStats?.failed} />
                        <Stat label="Expired" value={txStats?.expired} />
                        <Stat
                            label="Unprocessed"
                            value={txStats?.unprocessed}
                        />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

export default DashboardPage;
