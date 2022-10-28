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
import {
    Button,
    Form,
    Service,
    Logger,
    readLoggers,
    writeLoggers,
} from "./components";

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

type LogConfig = {
    type: string;
    filter: string;
    format: string;
    filename?: string;
    target?: string;
    rotationSize?: string;
    rotationTime?: string;
    maxSize?: string;
    maxFiles?: string;
    path?: string;
    flush?: boolean;
};

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
    loggers: { [index: string]: LogConfig };
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

function mergeServices(
    base: ServiceConfig[],
    updated: ServiceConfig[],
    user: ServiceConfig[]
): ServiceConfig[] {
    let leading: ServiceConfig[] = [];
    let result = updated.map((item) => [item]);
    let insertPoint = -1;
    const remove = (s: ServiceConfig): boolean => {
        const found = result.find(
            (item) => item.length && item[0].key == s.key
        );
        if (found) {
            found.shift();
            return true;
        }
        return false;
    };
    const replace = (s: ServiceConfig): void => {
        const pos = result.findIndex(
            (item) => item.length && item[0].key == s.key
        );
        if (pos != -1) {
            result[pos][0] = s;
            insertPoint = pos;
        }
    };
    // First delete anything that was deleted by the user
    let baseMap: { [index: string]: number } = {};
    let baseIndex = 0;
    for (const s of base) {
        if (!user.find((item) => item.key == s.key)) {
            remove(s);
        } else {
            baseMap[s.key] = baseIndex++;
        }
    }
    const insert = (s: ServiceConfig): void => {
        // prefer to put new values from the server before new values from the user
        while (
            insertPoint + 1 < result.length &&
            !user.find((item) => item.key == updated[insertPoint + 1].key)
        ) {
            ++insertPoint;
        }
        if (insertPoint == -1) {
            leading.push(s);
        } else {
            result[insertPoint].push(s);
        }
    };
    let prevIndex = 0;
    for (const s of user) {
        const baseIndex = baseMap[s.key];
        if (baseIndex === undefined) {
            // new item
            remove(s);
            insert(s);
        } else {
            if (prevIndex != baseIndex) {
                // The row was moved by the user
                if (remove(s)) insert(s);
            } else {
                replace(s);
            }
            prevIndex = baseIndex + 1;
        }
    }
    return leading.concat(...result);
}

function mergeLogger(prev: LogConfig, updated: LogConfig, user: LogConfig) {
    const result = { ...updated };
    if (updated.filter == prev.filter) {
        result.filter = user.filter;
    }
    if (updated.format == prev.format) {
        result.format = user.format;
    }
    if (user.type == "file" && updated.type == prev.type) {
        result.type = user.type;
        result.filename = mergeSimple(
            prev.filename,
            updated.filename,
            user.filename
        );
        result.target = mergeSimple(prev.target, updated.target, user.target);
        result.rotationSize = mergeSimple(
            prev.rotationSize,
            updated.rotationSize,
            user.rotationSize
        );
        result.rotationTime = mergeSimple(
            prev.rotationTime,
            updated.rotationTime,
            user.rotationTime
        );
        result.maxSize = mergeSimple(
            prev.maxSize,
            updated.maxSize,
            user.maxSize
        );
        result.maxFiles = mergeSimple(
            prev.maxFiles,
            updated.maxFiles,
            user.maxFiles
        );
        result.flush = mergeSimple(prev.flush, updated.flush, user.flush);
    } else if (user.type == "local" && updated.type == prev.type) {
        result.type = user.type;
        result.path = mergeSimple(prev.path, updated.path, user.path);
    }
    return result;
}

function mergeLoggers(
    prev: { [index: string]: LogConfig },
    updated: { [index: string]: LogConfig },
    user: { [index: string]: LogConfig }
): { [index: string]: LogConfig } {
    const result = { ...user };
    for (const key in prev) {
        if (!(key in updated)) {
            delete result[key];
        }
    }
    for (const key in updated) {
        if (key in result) {
            result[key] = mergeLogger(prev[key], updated[key], result[key]);
        } else if (!(key in prev)) {
            result[key] = updated[key];
        }
    }
    return result;
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
        services: mergeServices(
            prev.services.filter((item) => !emptyService(item)),
            updated.services,
            user.services
        ),
        admin: mergeSimple(prev.admin, updated.admin, user.admin),
        loggers: mergeLoggers(prev.loggers, updated.loggers, user.loggers),
    };
}

function emptyService(s: ServiceConfig) {
    return s.host == "" && s.root == "";
}

function defaultService(root: string) {
    if (root) {
        return root.substring(root.lastIndexOf("/") + 1) + ".";
    } else {
        return "";
    }
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

    const [logFilter, setLogFilter] = useState("Severity >= info");
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
            services: [{ host: "", root: "", key: "x" }],
            admin: "",
            loggers: {},
        },
    });
    configForm.formState.dirtyFields;
    const onConfig = async (input: PsinodeConfig) => {
        try {
            setConfigPutError(undefined);
            for (let service of input.services) {
                if (service.host == "") {
                    service.host = defaultService(service.root);
                }
            }
            const result = await putJson("/native/admin/config", {
                ...input,
                services: input.services
                    .filter((s) => !emptyService(s))
                    .map((s) => ({
                        host: s.host,
                        root: s.root,
                    })),
                admin: input.admin != "" ? input.admin : null,
                loggers: writeLoggers(input.loggers),
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
                    const userValues = configForm.getValues();
                    result.services = result.services.map((s: any) => {
                        const old =
                            oldDefaults.services.find(
                                (item) =>
                                    item.host == s.host && item.root == s.root
                            ) ||
                            userValues.services.find(
                                (item) =>
                                    item.host == s.host && item.root == s.root
                            );
                        return { key: old ? old.key : newId(), ...s };
                    });
                    result.loggers = readLoggers(result.loggers);
                    result.admin = result.admin ? result.admin : "";
                    let newState = mergeConfig(oldDefaults, result, userValues);
                    if (
                        userValues.services.length > 0 &&
                        emptyService(userValues.services.at(-1)!)
                    ) {
                        result.services = [
                            ...result.services,
                            userValues.services.at(-1),
                        ];
                    } else {
                        result.services = [
                            ...result.services,
                            { host: "", root: "", key: newId() },
                        ];
                    }
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

    const loggers = configForm.watch("loggers");

    // Fix up the default value of the key after deleting the last row
    // This is strictly to keep the form's dirty state correct.
    useEffect(() => {
        const fields = services.fields;
        if (fields !== undefined) {
            const defaultValues = configForm.formState
                .defaultValues as PsinodeConfig;
            if (
                fields.length != 0 &&
                fields.length == defaultValues.services.length &&
                emptyService(fields.at(-1)!) &&
                emptyService(defaultValues.services.at(-1)!)
            ) {
                const index = fields.length - 1;
                const key: `services.${number}.key` = `services.${index}.key`;
                configForm.resetField(key, {
                    defaultValue: configForm.getValues(key),
                });
            }
        }
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
                <Form.Input label="Host" {...configForm.register("host")} />
                <Form.Input
                    label="Port (requires restart)"
                    type="number"
                    min="0"
                    max="65535"
                    {...configForm.register("port")}
                />
                {loggers &&
                    Object.entries(loggers).map(([name, contents]) => (
                        <Logger
                            key={name}
                            name={name}
                            register={(field, options) =>
                                configForm.register(
                                    `loggers.${name}.${field}`,
                                    options
                                )
                            }
                            watch={(field) =>
                                configForm.watch(`loggers.${name}.${field}`)
                            }
                            remove={() => {
                                // This differs from unregister by preserving the loggers
                                // subobject even if it becomes empty
                                const state = configForm.getValues();
                                delete state.loggers[name];
                                configForm.reset(state, {
                                    keepDefaultValues: true,
                                });
                            }}
                        />
                    ))}
                <Button
                    onClick={() => {
                        const state = configForm.getValues();
                        if (!state.loggers) {
                            state.loggers = {};
                        }
                        const autogen = /^~[0-9A-F]{16}$/;
                        let current = 0;
                        for (const key in state.loggers) {
                            if (autogen.test(key)) {
                                const val = parseInt(key.substring(1), 16);
                                if (val > current) {
                                    current = val;
                                }
                            }
                        }
                        current =
                            (current & 0xffff0000) +
                            0x10000 +
                            Math.floor(Math.random() * 0x10000);
                        state.loggers[
                            "~" +
                                current
                                    .toString(16)
                                    .toUpperCase()
                                    .padStart(8, "0")
                        ] = {
                            type: "",
                            filter: "",
                            format: "",
                        };
                        configForm.reset(state, { keepDefaultValues: true });
                    }}
                >
                    New Logger
                </Button>
                <fieldset>
                    <legend>Builtin Services</legend>
                    <table className="service-table">
                        <thead>
                            <tr>
                                <th>Hostname</th>
                                <th>Path</th>
                            </tr>
                        </thead>
                        <tbody>
                            {services.fields.map((field, index) => (
                                <Service
                                    key={field.key}
                                    register={(name, options) =>
                                        configForm.register(
                                            `services.${name}`,
                                            options
                                        )
                                    }
                                    getValues={() =>
                                        configForm.getValues(
                                            `services.${index}`
                                        ) as ServiceConfig
                                    }
                                    index={index}
                                    services={services}
                                    newId={newId}
                                />
                            ))}
                        </tbody>
                    </table>
                </fieldset>
                <fieldset>
                    <legend>Access to admin API</legend>
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
