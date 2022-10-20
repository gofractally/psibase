import { useEffect, useState } from "react";
import { useFieldArray, useForm, SubmitHandler } from "react-hook-form";
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
import { Button, Form, Service } from "./components";

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

type ServiceConfig = {
    host: string;
    root: string;
    // auto-generated
    key: string;
};

type PsinodeConfig = {
    p2p: boolean;
    producer: string;
    host: string;
    port: number;
    services: ServiceConfig[];
    admin: string;
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

type DiffItem<T> = {
    modified: boolean;
    value?: T;
    insertions: T[];
};

function diff<T>(
    base: T[],
    value: T[],
    cmp: (a: T, b: T) => boolean | "samekey"
): DiffItem<T>[] {
    type RowKind = "root" | "insert" | "delete" | "keep" | "modify";
    type EDiffRow = {
        quality: number;
        kind: RowKind;
    };
    let data: EDiffRow[][] = [];
    const cell = (i: number, j: number): EDiffRow => {
        if (i < 0 && j < 0) {
            return { quality: 0, kind: "root" };
        } else if (i < 0) {
            return { quality: j + 1, kind: "insert" };
        } else if (j < 0) {
            return { quality: i + 1, kind: "delete" };
        } else {
            return data[i][j];
        }
    };
    const update = (
        current: EDiffRow | undefined,
        prev: EDiffRow,
        kind: RowKind
    ) => {
        if (current === undefined || prev.quality < current.quality) {
            return {
                quality: prev.quality + (kind == "keep" ? 0 : 1),
                kind: kind,
            };
        } else {
            return current;
        }
    };

    for (const [i, ival] of base.entries()) {
        data[i] = Array(value.length);
        for (const [j, jval] of value.entries()) {
            const res = cmp(ival, jval);
            let current: EDiffRow | undefined = undefined;
            if (res == true || res == "samekey") {
                current = update(
                    current,
                    cell(i - 1, j - 1),
                    res === true ? "keep" : "modify"
                );
            }
            current = update(current, cell(i - 1, j), "delete");
            current = update(current, cell(i, j - 1), "insert");
            data[i][j] = current;
        }
    }

    let result = Array<DiffItem<T>>(base.length + 1);
    let i = base.length - 1;
    let j = value.length - 1;
    while (true) {
        const { kind } = cell(i, j);
        if (result[i + 1] === undefined) {
            result[i + 1] = { modified: false, value: base[i], insertions: [] };
        }
        if (kind == "root") {
            console.log(base);
            console.log(value);
            console.log(data);
            console.log(result);
            return result;
        } else if (kind == "insert") {
            result[i + 1].insertions = [value[j], ...result[i + 1].insertions];
            j = j - 1;
        } else if (kind == "delete") {
            result[i + 1].modified = true;
            result[i + 1].value = undefined;
            i = i - 1;
        } else if (kind == "keep") {
            result[i + 1].modified = false;
            result[i + 1].value = base[i];
            i = i - 1;
            j = j - 1;
        } else if (kind == "modify") {
            result[i + 1].modified = true;
            result[i + 1].value = value[j];
            i = i - 1;
            j = j - 1;
        }
    }
    return result;
}

function mergeDiff<T>(
    diff1: DiffItem<T>[],
    diff2: DiffItem<T>[]
): DiffItem<T>[] {
    return diff1.map((v1, idx) => {
        const v2 = diff2[idx];
        return {
            modified: v1.modified || v2.modified,
            value: v1.modified ? v1.value : v2.value,
            insertions: [...v1.insertions, ...v2.insertions],
        };
    });
}

function idiff<T>(diff: DiffItem<T>[]): T[] {
    let result: T[] = [];
    for (const item of diff) {
        if (item.value) {
            result = [...result, item.value];
        }
        result = [...result, ...item.insertions];
    }
    return result;
}

function mergeList<T>(
    prev: T[],
    updated: T[],
    user: T[],
    cmp: (a: T, b: T) => boolean | "samekey"
): T[] {
    return idiff(mergeDiff(diff(prev, updated, cmp), diff(prev, user, cmp)));
}

function compareService(
    a: ServiceConfig,
    b: ServiceConfig
): boolean | "samekey" {
    if (a.host == b.host && a.root == b.root) {
        return true;
    } else if (a.host == b.host) {
        return "samekey";
    } else {
        return false;
    }
}

function mergeSimple<T>(prev: T, updated: T, user: T): T {
    return prev == updated ? user : updated;
}

let nextId = 1;
function newId(): string {
    return (nextId++).toString();
}

// On conflict, updated overrides user
function mergeConfig(
    prev: PsinodeConfig,
    updated: PsinodeConfig,
    user: PsinodeConfig
): PsinodeConfig {
    return {
        ...updated,
        p2p: mergeSimple(prev.p2p, updated.p2p, user.p2p),
        producer: mergeSimple(prev.producer, updated.producer, user.producer),
        host: mergeSimple(prev.host, updated.host, user.host),
        port: mergeSimple(prev.port, updated.port, user.port),
        services: mergeList(
            prev.services,
            updated.services,
            user.services,
            compareService
        ),
        admin: mergeSimple(prev.admin, updated.admin, user.admin),
    };
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
            host: "",
            port: 0,
            services: [],
            admin: "",
        },
    });
    configForm.formState.dirtyFields;
    const onConfig = async (input: PsinodeConfig) => {
        try {
            setConfigPutError(undefined);
            const result = await putJson("/native/admin/config", {
                ...input,
                services: input.services.map((s) => ({
                    host: s.host,
                    root: s.root,
                })),
                admin: input.admin != "" ? input.admin : null,
            });
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
                    const oldDefaults = configForm.formState
                        .defaultValues as PsinodeConfig;
                    result.services = result.services.map((s: any) => {
                        const old = oldDefaults.services.find(
                            (item) => item.host == s.host && item.root == s.root
                        );
                        return { key: old ? old.key : newId(), ...s };
                    });
                    result.admin = result.admin ? result.admin : "";
                    let newState = mergeConfig(
                        oldDefaults,
                        result,
                        configForm.getValues()
                    );
                    configForm.reset(result, {
                        keepDirty: true,
                        keepValues: true,
                    });
                    configForm.reset(newState, { keepDefaultValues: true });
                    setConfigError(undefined);
                    setConfigTimeout(
                        setTimeout(() => setConfigTimeout(undefined), 3000)
                    );
                } catch (e) {
                    console.error(e);
                    setConfigError("Failed to load /native/admin/config");
                    setConfigTimeout(
                        setTimeout(() => setConfigTimeout(undefined), 10000)
                    );
                }
            })();
        }
    }, [configTimeout]);

    const services = useFieldArray({
        control: configForm.control,
        name: "services",
    });

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
                {services.fields.map((field, index) => (
                    <Service
                        key={field.key}
                        register={(name) =>
                            configForm.register(`services.${name}`)
                        }
                        index={index}
                        services={services}
                    />
                ))}
                <fieldset>
                    <legend>Access to admin API (Requires restart)</legend>
                    <Form.Radio
                        {...configForm.register("admin")}
                        value="static:*"
                        label="Builtin services only (recommended)"
                    />
                    <Form.Radio
                        {...configForm.register("admin")}
                        value="*"
                        label="All services (not recommended)"
                    />
                    <Form.Radio
                        {...configForm.register("admin")}
                        value=""
                        label="Disabled"
                    />
                </fieldset>
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
