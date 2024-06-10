import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { websocketURL } from "../helpers";
import { LogFilterInputs, LogRecord } from "./interfaces";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableFooter,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

const MAX_LOGS_ROWS = 20;

export const LogsPage = () => {
    const [logFilter, setLogFilter] = useState("Severity >= info");
    const [logData, setLogData] = useState<LogRecord[]>();

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
                setLogData((prev: LogRecord[] | undefined) => [
                    ...(prev ?? []).slice(-MAX_LOGS_ROWS + 1),
                    JSON.parse(event.data) as LogRecord,
                ]);
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
    }, [logSocket, logTimeout]);

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
        <>
            <h1 className="mb-2">Logs</h1>
            {logConnectionError && (
                <p className="bg-red-100 p-4">
                    🔴 {logConnectionError || "Unknown log connection error"}
                </p>
            )}
            <form onSubmit={filterForm.handleSubmit(onFilter)}>
                <Label>Filter</Label>
                <Input {...filterForm.register("filter")} />
                {filterError && <Label>{filterError}</Label>}
            </form>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead>Message</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {(logData || []).map((row: LogRecord, idx) => (
                        <TableRow
                            key={idx}
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
        </>
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
