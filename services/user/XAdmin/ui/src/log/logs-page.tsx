import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { websocketURL } from "../helpers";
import { LogFilterInputs, LogRecord } from "./interfaces";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Table,
    TableBody,
    TableCell,
    TableFooter,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { z } from "zod";

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
            newSocket.addEventListener("open", (event: Event) => {
                setLogConnectionError(undefined);
                if (logFilter) {
                    setFilterError(undefined);
                    newSocket.send(JSON.stringify({ filter: logFilter }));
                }
            });
            newSocket.addEventListener("message", (event: MessageEvent) => {
                setLogData((prev) => {
                    const newRecord = LogRecordSchema.parse(
                        JSON.parse(event.data)
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
        <div className="h-dvh ">
            {logConnectionError && (
                <Alert variant="destructive">
                    <AlertDescription>
                        {logConnectionError || "Unknown log connection error"}
                    </AlertDescription>
                </Alert>
            )}
            <div className="flex justify-between py-3">
                <h1 className="">Logs</h1>
                <div className="flex">
                    <Label className="my-auto mr-2">Keep all logs</Label>
                    <Switch
                        onCheckedChange={(checked) =>
                            (keepAllLogs.current = checked)
                        }
                    />
                </div>
            </div>

            <form onSubmit={filterForm.handleSubmit(onFilter)}>
                <Label>Filter</Label>
                <Input {...filterForm.register("filter")} />
                {filterError && <Label>{filterError}</Label>}
            </form>
            <div className="max-h-full overflow-y-scroll">
                <Table className="">
                    <TableHeader>
                        <TableRow>
                            <TableHead>Time</TableHead>
                            <TableHead>Severity</TableHead>
                            <TableHead>Message</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {(logData || []).map((row: LogRecord, index) => (
                            <TableRow
                                key={index}
                                className={`log log-${row.Severity}`}
                            >
                                <TableCell>
                                    {new Date(row.TimeStamp).toLocaleString()}
                                </TableCell>
                                <TableCell>{row.Severity}</TableCell>
                                <TableCell className="log-message">
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
