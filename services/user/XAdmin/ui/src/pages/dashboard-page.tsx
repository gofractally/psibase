import { Label, Pie, PieChart } from "recharts";

import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type CustomTooltipProps,
} from "@shared/shadcn/ui/chart";
import { Separator } from "@shared/shadcn/ui/separator";

import { usePerformance } from "../hooks/usePerformance";

const chartConfig = {
    database: {
        label: "Database",
        color: "hsl(var(--chart-1))",
    },
    code: {
        label: "Code",
        color: "hsl(var(--chart-2))",
    },
    data: {
        label: "Data",
        color: "hsl(var(--chart-5))",
    },
    wasmMemory: {
        label: "WASM Memory",
        color: "hsl(var(--chart-3))",
    },
    wasmCode: {
        label: "WASM Code",
        color: "hsl(var(--chart-4))",
    },
    unclassified: {
        label: "Unclassified",
        color: "hsl(var(--chart-5))",
    },
} satisfies ChartConfig;

const bytesToMb = (bytes: number): number => Math.ceil(bytes / 1024 / 1024);

export function Component() {
    const { data } = usePerformance();

    const chartData = [
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
    ];

    const totalVisitorsBytes = chartData
        ? chartData.reduce((acc, curr) => acc + curr.usage, 0)
        : 0;

    if (!chartData) return <div>Loading...</div>;

    return (
        <Card className="flex flex-col">
            <CardHeader className="items-center pb-0">
                <CardTitle>RAM Usage</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 pb-0">
                <ChartContainer
                    config={chartConfig}
                    className="mx-auto aspect-square max-h-[250px]"
                >
                    <PieChart>
                        <ChartTooltip
                            cursor={false}
                            content={(props: CustomTooltipProps) => (
                                <ChartTooltipContent {...props} hideLabel />
                            )}
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
                                                    {totalVisitorsBytes.toLocaleString()}
                                                </tspan>
                                                <tspan
                                                    x={viewBox.cx}
                                                    y={(viewBox.cy || 0) + 24}
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
            <CardFooter className="flex flex-row border-t p-4">
                <div className="flex w-full items-center gap-2">
                    <div className="grid flex-1 auto-rows-min gap-0.5">
                        <div className="text-muted-foreground text-xs">
                            Failed
                        </div>
                        <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                            {data?.transactions.failed}
                            <span className="text-muted-foreground text-sm font-normal">
                                transactions
                            </span>
                        </div>
                    </div>
                    <Separator
                        orientation="vertical"
                        className="mx-2 h-10 w-px"
                    />
                    <div className="grid flex-1 auto-rows-min gap-0.5">
                        <div className="text-muted-foreground text-xs">
                            Skipped
                        </div>
                        <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                            {data?.transactions.skipped}
                            <span className="text-muted-foreground text-sm font-normal">
                                transactions
                            </span>
                        </div>
                    </div>
                    <Separator
                        orientation="vertical"
                        className="mx-2 h-10 w-px"
                    />
                    <div className="grid flex-1 auto-rows-min gap-0.5">
                        <div className="text-muted-foreground text-xs">
                            Unprocessed
                        </div>
                        <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                            {data?.transactions.unprocessed}
                            <span className="text-muted-foreground text-sm font-normal">
                                transactions
                            </span>
                        </div>
                    </div>
                    <Separator
                        orientation="vertical"
                        className="mx-2 h-10 w-px"
                    />
                    <div className="grid flex-1 auto-rows-min gap-0.5">
                        <div className="text-muted-foreground text-xs">
                            Succeeded
                        </div>
                        <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                            {data?.transactions.succeeded}
                            <span className="text-muted-foreground text-sm font-normal">
                                transactions
                            </span>
                        </div>
                    </div>
                </div>
            </CardFooter>
        </Card>
    );
}

export const DashboardPage = () => {
    return (
        <div>
            <h2 className="scroll-m-20  pb-2 text-3xl font-semibold tracking-tight ">
                Dashboard
            </h2>
            <Component />
        </div>
    );
};
