import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { Form } from "../components";
import { websocketURL } from "../helpers";
import { LogFilterInputs, LogRecord } from "./interfaces";

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
                <Form.Input
                    label="Filter"
                    {...filterForm.register("filter")}
                    errorText={filterError}
                />
            </form>
            <table className="my-4 w-full bg-black p-2 font-mono text-white">
                <thead className="font-semibold">
                    <tr>
                        <td className="p-2">Time</td>
                        <td>Severity</td>
                        <td>Message</td>
                    </tr>
                </thead>
                <tbody>
                    {logData?.length ? (
                        logData.map((row: LogRecord, idx) => (
                            <tr key={idx} className={`log log-${row.Severity}`}>
                                <td>
                                    {new Date(row.TimeStamp).toLocaleString()}
                                </td>
                                <td>{row.Severity}</td>
                                <td className="log-message">
                                    {formatLog(row)}
                                </td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={3} className="h-16 text-center">
                                No logs to display.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
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
