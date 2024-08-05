import { useGraphana, url } from "../hooks/useGraphana";

interface Props {
    url: string;
}

import { Label, Pie, PieChart } from "recharts";

import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from "@/components/ui/chart";
import { Separator } from "@/components/ui/separator";
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
        label: "Firefox",
        color: "hsl(var(--chart-3))",
    },
    wasmCode: {
        label: "Edge",
        color: "hsl(var(--chart-4))",
    },
    unclassified: {
        label: "Other",
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
                            content={<ChartTooltipContent hideLabel />}
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
                        <div className="text-xs text-muted-foreground">
                            Failed
                        </div>
                        <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                            {data?.transactions.failed}
                            <span className="text-sm font-normal text-muted-foreground">
                                transactions
                            </span>
                        </div>
                    </div>
                    <Separator
                        orientation="vertical"
                        className="mx-2 h-10 w-px"
                    />
                    <div className="grid flex-1 auto-rows-min gap-0.5">
                        <div className="text-xs text-muted-foreground">
                            Skipped
                        </div>
                        <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                            {data?.transactions.skipped}
                            <span className="text-sm font-normal text-muted-foreground">
                                transactions
                            </span>
                        </div>
                    </div>
                    <Separator
                        orientation="vertical"
                        className="mx-2 h-10 w-px"
                    />
                    <div className="grid flex-1 auto-rows-min gap-0.5">
                        <div className="text-xs text-muted-foreground">
                            Unprocessed
                        </div>
                        <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                            {data?.transactions.unprocessed}
                            <span className="text-sm font-normal text-muted-foreground">
                                transactions
                            </span>
                        </div>
                    </div>
                    <Separator
                        orientation="vertical"
                        className="mx-2 h-10 w-px"
                    />
                    <div className="grid flex-1 auto-rows-min gap-0.5">
                        <div className="text-xs text-muted-foreground">
                            Succeeded
                        </div>
                        <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                            {data?.transactions.succeeded}
                            <span className="text-sm font-normal text-muted-foreground">
                                transactions
                            </span>
                        </div>
                    </div>
                </div>
            </CardFooter>
        </Card>
    );
}

const Graphana = ({ url }: Props) => {
    return (
        <iframe
            src={url}
            style={{ overflow: "hidden", height: "100%", width: "100%" }}
            height="100%"
            width="100%"
        />
    );
};

export const DashboardPage = () => {
    const { isSuccess } = useGraphana();

    return (
        <div>
            <h2 className="scroll-m-20  pb-2 text-3xl font-semibold tracking-tight ">
                Dashboard
            </h2>
            {isSuccess && <Graphana url={url} />}
            <Component />
        </div>
    );
};
