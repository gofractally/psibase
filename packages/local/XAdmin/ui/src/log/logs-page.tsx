import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { PageHeading } from "@/components/page-heading";

import { Alert, AlertDescription } from "@shared/shadcn/ui/alert";
import { Badge } from "@shared/shadcn/ui/badge";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Switch } from "@shared/shadcn/ui/switch";
import {
    Table,
    TableBody,
    TableCell,
    TableFooter,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

import { websocketURL } from "../helpers";
import { LogFilterInputs, LogRecord } from "./interfaces";

const MAX_LOGS_ROWS = 20;

export const LogRecordSchema = z.object({
    TimeStamp: z.string(),
    Severity: z.string(),
    Message: z.string(),
    RemoteEndpoint: z.string().optional(),
    BlockId: z.string().optional(),
    Request: z
        .object({
            Method: z.string(),
            Target: z.string(),
            Host: z.string(),
        })
        .optional(),
    Response: z
        .object({
            Status: z.number(),
            Bytes: z.number().optional(),
            Time: z.number().optional(),
        })
        .optional(),
});

export const LogsPage = () => {
    const [logFilter, setLogFilter] = useState("Severity >= info");
    const [logData, setLogData] = useState<LogRecord[]>([]);

    const [logConnectionError, setLogConnectionError] = useState<string>();
    const [logSocket, setLogSocket] = useState<WebSocket | null>(null);
    const [logTimeout, setLogTimeout] = useState<ReturnType<
        typeof setTimeout
    > | null>(null);

    const [filterError, setFilterError] = useState<string>();

    const filterForm = useForm<LogFilterInputs>({
        defaultValues: {
            filter: logFilter,
        },
    });

    const keepAllLogs = useRef(false);

    useEffect(() => {
        if (logSocket === null && logTimeout === null) {
            const newSocket = new WebSocket(websocketURL("/native/admin/log"));
            setLogSocket(newSocket);
            newSocket.addEventListener("open", () => {
                setLogConnectionError(undefined);
                if (logFilter) {
                    setFilterError(undefined);
                    newSocket.send(JSON.stringify({ filter: logFilter }));
                }
            });
            newSocket.addEventListener("message", (event: MessageEvent) => {
                setLogData((prev) => {
                    const newRecord = LogRecordSchema.parse(
                        JSON.parse(event.data),
                    );
                    return [
                        newRecord,
                        ...(keepAllLogs.current
                            ? prev
                            : prev.slice(0, MAX_LOGS_ROWS - 1)),
                    ];
                });
            });
            newSocket.addEventListener("close", (event: CloseEvent) => {
                if (event.code == 1008) {
                    setFilterError(event.reason);
                } else {
                    setLogConnectionError(`No connection to ${newSocket.url}`);
                }
                setLogTimeout(setTimeout(() => setLogTimeout(null), 10000));
                setLogSocket(null);
            });
        }
        //  else if (!logEnabled && logSocket) {
        //     logSocket.close();
        // }
    }, [logSocket, logTimeout, keepAllLogs]);

    const onFilter = (input: LogFilterInputs) => {
        setLogFilter(input.filter);
        if (filterError !== undefined && logTimeout) {
            clearTimeout(logTimeout);
            setLogTimeout(null);
        }
        if (logSocket !== null && logSocket.readyState == 1) {
            setFilterError(undefined);
            logSocket.send(JSON.stringify({ filter: input.filter }));
        }
    };

    return (
        <div className="flex min-h-0 flex-col">
            {logConnectionError && (
                <Alert variant="destructive" className="mb-4">
                    <AlertDescription>
                        {logConnectionError || "Unknown log connection error"}
                    </AlertDescription>
                </Alert>
            )}
            <PageHeading
                title="Logs"
                description="Live node logs. Press Enter to apply a filter."
                actions={
                    <div className="flex items-center gap-2">
                        <Label htmlFor="keep-all-logs">Keep all logs</Label>
                        <Switch
                            id="keep-all-logs"
                            onCheckedChange={(checked) =>
                                (keepAllLogs.current = checked)
                            }
                        />
                    </div>
                }
            />

            <form
                onSubmit={filterForm.handleSubmit(onFilter)}
                className="mb-4 space-y-1.5"
            >
                <Label htmlFor="log-filter">Filter</Label>
                <Input
                    id="log-filter"
                    placeholder="Severity >= info"
                    {...filterForm.register("filter")}
                />
                {filterError && (
                    <p className="text-destructive text-sm">{filterError}</p>
                )}
            </form>
            <div className="overflow-y-auto rounded-lg border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-48">Time</TableHead>
                            <TableHead className="w-28">Severity</TableHead>
                            <TableHead>Message</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {(logData || []).map((row: LogRecord, index) => (
                            <TableRow
                                key={index}
                                className={`log log-${row.Severity}`}
                            >
                                <TableCell className="text-muted-foreground whitespace-nowrap">
                                    {new Date(row.TimeStamp).toLocaleString()}
                                </TableCell>
                                <TableCell>
                                    <Badge
                                        variant={severityVariant(row.Severity)}
                                    >
                                        {row.Severity}
                                    </Badge>
                                </TableCell>
                                <TableCell className="log-message whitespace-normal">
                                    {formatLog(row)}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                    {(logData || []).length == 0 && (
                        <TableFooter>
                            <TableRow>
                                <TableCell colSpan={3}>
                                    No logs to display.
                                </TableCell>
                            </TableRow>
                        </TableFooter>
                    )}
                </Table>
            </div>
        </div>
    );
};

function severityVariant(
    severity: string,
): "default" | "secondary" | "destructive" | "outline" {
    const value = severity.toLowerCase();
    if (value.includes("error") || value.includes("fatal")) {
        return "destructive";
    }
    if (value.includes("warn")) {
        return "outline";
    }
    return "secondary";
}

function formatLog(row: LogRecord): string {
    let result = row.Message;
    if (row.RemoteEndpoint) {
        result = `[${row.RemoteEndpoint}]: ${result}`;
    }
    if (row.BlockId) {
        result = `${result} ${row.BlockId}`;
    }
    if (row.Request) {
        result = `${result}: ${row.Request.Method} ${row.Request.Host}${row.Request.Target}`;
        if (row.Response) {
            result += ` ${row.Response.Status}`;
            if (row.Response.Bytes) {
                result += ` ${row.Response.Bytes}`;
            }
            if (row.Response.Time) {
                result += ` ${row.Response.Time} \u00B5s`;
            }
        }
    }
    return result;
}
