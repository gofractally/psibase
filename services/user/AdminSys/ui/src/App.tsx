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

type PsinodeConfig = {
    p2p: boolean;
    producer: string;
    host: string;
    port: number;
};

async function putJson(url: string, json: any) {
    return fetch(url, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(json),
    });
}

function pollJson<R>(
    url: string
): [R | undefined, string | undefined, () => void] {
    const [pollTimer, setPollTimer] = useState<
        ReturnType<typeof setTimeout> | null | undefined
    >();
    const [error, setError] = useState<string>();
    const [value, setValue] = useState<R>();
    useEffect(() => {
        if (pollTimer === undefined) {
            setPollTimer(null);
            (async () => {
                try {
                    let result = await getJson(url);
                    setValue(result);
                    setError(undefined);
                    setPollTimer(
                        setTimeout(() => setPollTimer(undefined), 3000)
                    );
                } catch (e) {
                    setError(`Failed to load ${url}`);
                    setPollTimer(
                        setTimeout(() => setPollTimer(undefined), 10000)
                    );
                }
            })();
        }
    }, [pollTimer]);
    return [
        value,
        error,
        () => {
            if (pollTimer !== undefined && pollTimer !== null) {
                clearTimeout(pollTimer);
                setPollTimer(undefined);
            }
        },
    ];
}

function App() {
    const [peers, peersError, refetchPeers] = pollJson<Peer[]>(
        "/native/admin/peers"
    );

    const onDisconnect = async (id: number) => {
        try {
            await postJson("/native/admin/disconnect", { id: id });
            refetchPeers();
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
            refetchPeers();
        } catch (e) {
            console.error("CONNECT ERROR", e);
        }
    };

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

    const [configError, setConfigError] = useState<string>();
    const [configPutError, setConfigPutError] = useState<string>();
    //

    const configForm = useForm<PsinodeConfig>({
        defaultValues: {
            p2p: false,
            producer: "",
        },
    });
    configForm.formState.dirtyFields;
    const onConfig = async (input: PsinodeConfig) => {
        try {
            setConfigPutError(undefined);
            const result = await putJson("/native/admin/config", input);
            if (result.ok) {
                configForm.reset(input);
            } else {
                setConfigPutError(await result.text());
            }
        } catch (e) {
            console.error("error", e);
            setConfigPutError("Failed to write /native/admin/config");
        }
    };

    const [configTimeout, setConfigTimeout] = useState<
        ReturnType<typeof setTimeout> | null | undefined
    >();
    useEffect(() => {
        if (configTimeout === undefined) {
            setConfigTimeout(null);
            (async () => {
                try {
                    let result = await getJson("/native/admin/config");
                    configForm.reset(result, { keepDirtyValues: true });
                    setConfigError(undefined);
                    setConfigTimeout(
                        setTimeout(() => setConfigTimeout(undefined), 3000)
                    );
                } catch (e) {
                    setConfigError("Failed to load /native/admin/config");
                    setConfigTimeout(
                        setTimeout(() => setConfigTimeout(undefined), 10000)
                    );
                }
            })();
        }
    }, [configTimeout]);

    const [status, statusError, fetchStatus] = pollJson<string[]>(
        "/native/admin/status"
    );

    let serverStatus = [
        ...(status || []),
        ...(!statusError ? [] : [statusError]),
        ...(!peersError ? [] : [peersError]),
        ...(!configError ? [] : [configError]),
        ...(!logConnectionError ? [] : [logConnectionError]),
    ];
    if (peersError && configError && logConnectionError && statusError) {
        serverStatus = ["Not connected"];
    }

    if (!serverStatus || serverStatus.length == 0) {
        serverStatus = ["Ready"];
    }

    return (
        <div>
            <h1>Status</h1>
            {serverStatus?.map((id) => {
                if (id == "slow") {
                    return (
                        <p>
                            Failed to lock database memory. Performance may be
                            degraded.
                        </p>
                    );
                } else if (id == "startup") {
                    return <p>Initializing</p>;
                } else {
                    return <p>{id}</p>;
                }
            })}
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
            <h1>Configuration</h1>
            <form onSubmit={configForm.handleSubmit(onConfig)}>
                <Form.Checkbox
                    label="Accept incoming P2P connections"
                    {...configForm.register("p2p")}
                />
                <Form.Input
                    label="Block Producer Name"
                    {...configForm.register("producer")}
                />
                <Form.Input
                    label="Host (requires restart)"
                    {...configForm.register("host")}
                />
                <Form.Input
                    label="Port (requires restart)"
                    type="number"
                    min="0"
                    max="65535"
                    {...configForm.register("port")}
                />
                <Button isSubmit disabled={!configForm.formState.isDirty}>
                    Save Changes
                </Button>
            </form>
            {configPutError && <div>{configPutError}</div>}
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
        </div>
    );
}

export default App;
