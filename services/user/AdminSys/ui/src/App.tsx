import { useEffect, useState } from "react";
import { useForm, SubmitHandler } from "react-hook-form";
import "./App.css";
import {
    initializeApplet,
    action,
    operation,
    siblingUrl,
    getJson,
    postJson,
    postText,
    setOperations,
} from "common/rpc.mjs";
import { wait } from "./helpers";
import { Button, Form } from "./components";

type Peer = {
    id: number;
    endpoint: string;
};

type ConnectInputs = {
    url: string;
};

type LogFilterInputs = {
    filter: string;
};

type LogRecord = {
    TimeStamp: string;
    Severity: string;
    Message: string;
    RemoteEndpoint?: string;
    BlockId?: string;
};

function formatLog(row: LogRecord): string {
    let result = row.Message;
    if (row.RemoteEndpoint) {
        result = `[${row.RemoteEndpoint}]: ${result}`;
    }
    if (row.BlockId) {
        result = `${result} ${row.BlockId}`;
    }
    return result;
}

function websocketURL(path: string) {
    let result = new URL(path, document.URL);
    if (result.protocol == "http:") {
        result.protocol = "ws:";
    } else if (result.protocol == "https:") {
        result.protocol = "wss:";
    }
    return result;
}

function App() {
    const [fetchPeers, setFetchPeers] = useState(true);
    const [peers, setPeers] = useState<Peer[]>();
    useEffect(() => {
        (async () => {
            if (fetchPeers) {
                let result = await getJson("/native/admin/peers");
                setPeers(result);
                setFetchPeers(false);
            }
        })();
    });

    const onDisconnect = async (id: number) => {
        try {
            await postJson("/native/admin/disconnect", { id: id });
            setFetchPeers(true);
        } catch (e) {
            console.error("DISCONNECT ERROR", e);
        }
    };

    const {
        register,
        handleSubmit,
        formState: { errors },
        setError,
        reset,
    } = useForm<ConnectInputs>({
        defaultValues: {
            url: "",
        },
    });
    const onConnect: SubmitHandler<ConnectInputs> = async (
        endpoint: ConnectInputs
    ) => {
        try {
            await postJson("/native/admin/connect", endpoint);
            reset();
            setFetchPeers(true);
        } catch (e) {
            console.error("CONNECT ERROR", e);
        }
    };

    setInterval(() => {
        setFetchPeers(true);
    }, 3000);

    const [logFilter, setLogFilter] = useState("%Severity% >= info");
    const [logData, setLogData] = useState<LogRecord[]>();
    const maxLog = 20;

    const [logConnectionError, setLogConnectionError] = useState<string>();
    const [logEnabled, setLogEnabled] = useState(true);
    const [logSocket, setLogSocket] = useState<WebSocket | null>(null);
    const [logTimeout, setLogTimeout] = useState<ReturnType<
        typeof setTimeout
    > | null>(null);

    const [filterError, setFilterError] = useState<string>();

    useEffect(() => {
        if (logEnabled && logSocket === null && logTimeout === null) {
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
                    ...(prev ?? []).slice(-maxLog + 1),
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
        } else if (!logEnabled && logSocket) {
            logSocket.close();
        }
    }, [logEnabled, logSocket, logTimeout]);

    const filterForm = useForm<LogFilterInputs>({
        defaultValues: {
            filter: logFilter,
        },
    });
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
        <div>
            <h1>Peers</h1>
            <table>
                <thead>
                    <tr>
                        <td>Remote Endpoint</td>
                    </tr>
                </thead>
                <tbody>
                    {peers?.map((peer) => (
                        <tr>
                            <td>{peer.endpoint}</td>
                            <td>
                                <Button onClick={() => onDisconnect(peer.id)}>
                                    Disconnect
                                </Button>
                            </td>
                        </tr>
                    ))}
                    <tr>
                        <td>
                            <form
                                onSubmit={handleSubmit(onConnect)}
                                id="new-connection"
                            >
                                <Form.Input
                                    placeholder="host:port"
                                    {...register("url", {
                                        required: "This field is required",
                                    })}
                                    errorText={errors.url?.message}
                                />
                            </form>
                        </td>
                        <td>
                            <Button isSubmit form="new-connection">
                                Connect
                            </Button>
                        </td>
                    </tr>
                </tbody>
            </table>
            <h1>Log</h1>
            <form onSubmit={filterForm.handleSubmit(onFilter)}>
                <Form.Input
                    label="Filter"
                    {...filterForm.register("filter")}
                    errorText={filterError}
                />
            </form>
            <table>
                <thead>
                    <tr>
                        <td>Time</td>
                        <td>Severity</td>
                        <td>Message</td>
                    </tr>
                </thead>
                <tbody>
                    {logData?.map((row: LogRecord) => (
                        <tr className={`log log-${row.Severity}`}>
                            <td>{new Date(row.TimeStamp).toLocaleString()}</td>
                            <td>{row.Severity}</td>
                            <td className="log-message">{formatLog(row)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {logConnectionError && <div>{logConnectionError}</div>}
        </div>
    );
}

export default App;
