import { UseFormReturn } from "react-hook-form";
import { LogConfig } from "../log/interfaces";
import { readLoggers } from "../log/utils";
import { PsinodeConfig, ServiceConfig, ListenConfig } from "./interfaces";

export const initialConfigForm = () => ({
    p2p: false,
    producer: "",
    host: "",
    listen: [],
    services: [{ host: "", root: "", key: "x" }],
    admin: "",
    loggers: {},
});

export const emptyService = (s: ServiceConfig) => {
    return s.host == "" && s.root == "";
};

export const mergeSimple = <T>(prev: T, updated: T, user: T): T =>
    prev == updated ? user : updated;

export const mergeList = <T extends { key: string }>(
    base: T[],
    updated: T[],
    user: T[]
): T[] => {
    let leading: T[] = [];
    let result = updated.map((item) => [item]);
    let insertPoint = -1;
    const remove = (s: T): boolean => {
        const found = result.find(
            (item) => item.length && item[0].key == s.key
        );
        if (found) {
            found.shift();
            return true;
        }
        return false;
    };
    const replace = (s: T): void => {
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
    const insert = (s: T): void => {
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
};

export const mergeLogger = (
    prev: LogConfig,
    updated: LogConfig,
    user: LogConfig
) => {
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
};

export const mergeLoggers = (
    prev: { [index: string]: LogConfig },
    updated: { [index: string]: LogConfig },
    user: { [index: string]: LogConfig }
): { [index: string]: LogConfig } => {
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
};

function writeLogger(logger: LogConfig): LogConfig {
    const result: any = { ...logger };
    for (const key in result) {
        if (result[key] == "") {
            delete result[key];
        }
    }
    return result;
}

function unescapeKey(k: string): string {
    let result = "";
    let escape = false;
    for (const ch of k) {
        if (escape) {
            if (ch == "p") {
                result += ".";
            } else {
                result += ch;
            }
            escape = false;
        } else if (ch == "\\") {
            escape = true;
        } else {
            result += ch;
            escape = false;
        }
    }
    return result;
}

export function writeLoggers(loggers: { [index: string]: LogConfig }): {
    [index: string]: LogConfig;
} {
    const result: any = {};
    for (const key in loggers) {
        result[unescapeKey(key)] = writeLogger(loggers[key]);
    }
    return result;
}

function readListen(listen: ListenConfig): ListenConfig {
    const result = { ...listen };
    delete result.address;
    delete result.port;
    delete result.path;
    if (listen.protocol == "http" || listen.protocol == "https") {
        if (listen.address == "0.0.0.0") {
            return { text: String(listen.port), ...result };
        } else if (listen.address?.includes(":")) {
            return {
                text: "[" + listen.address + "]:" + listen.port,
                ...result,
            };
        } else {
            return { text: listen.address + ":" + listen.port, ...result };
        }
    } else if (listen.protocol == "local") {
        return { text: listen.path, ...result };
    }
    return listen;
}

function writeListen(listen: ListenConfig): any {
    if (listen.protocol == "http" || listen.protocol == "https") {
        const ipv4 = listen.text?.match(/^(\d+\.\d+.\d+.\d+)(?::(\d+))$/);
        if (ipv4) {
            return {
                protocol: listen.protocol,
                address: ipv4[1],
                port: Number(ipv4[2]),
            };
        }
        const ipv6 = listen.text?.match(/^\[(.*)\](?::(\d+))$/);
        if (ipv6) {
            return {
                protocol: listen.protocol,
                address: ipv6[1],
                port: Number(ipv6[2]),
            };
        }
        return {
            protocol: listen.protocol,
            address: "0.0.0.0",
            port: Number(listen.text),
        };
    } else if (listen.protocol == "local") {
        return { protocol: listen.protocol, path: listen.text };
    }
    return listen;
}

// On conflict, updated overrides user
export const mergeConfig = (
    prev: PsinodeConfig,
    updated: PsinodeConfig,
    user: PsinodeConfig
): PsinodeConfig => {
    return {
        ...updated,
        p2p: mergeSimple(prev.p2p, updated.p2p, user.p2p),
        producer: mergeSimple(prev.producer, updated.producer, user.producer),
        host: mergeSimple(prev.host, updated.host, user.host),
        listen: mergeList(prev.listen, updated.listen, user.listen),
        services: mergeList(
            prev.services.filter((item) => !emptyService(item)),
            updated.services,
            user.services
        ),
        admin: mergeSimple(prev.admin, updated.admin, user.admin),
        loggers: mergeLoggers(prev.loggers, updated.loggers, user.loggers),
    };
};

export const writeConfig = (input: PsinodeConfig) => {
    return {
        ...input,
        listen: input.listen.map(writeListen),
        services: input.services
            .filter((s) => !emptyService(s))
            .map((s) => ({
                host: s.host,
                root: s.root,
            })),
        admin: input.admin != "" ? input.admin : null,
        loggers: writeLoggers(input.loggers),
    };
};

export const defaultService = (root: string) => {
    if (root) {
        return root.substring(root.lastIndexOf("/") + 1) + ".";
    } else {
        return "";
    }
};

let nextId = 1;
export const newId = (): string => {
    return (nextId++).toString();
};

export const resolveListDiff = <T>(
    base: T[],
    updated: T[],
    user: T[],
    eq: (a: T, b: T) => boolean
): T[] => {
    return updated.map((s: any) => {
        const compare = (item: T) => eq(item, s);
        const old: any = base.find(compare) || user.find(compare);
        return { key: old ? old.key : newId(), ...s };
    });
};

export const resolveConfigFormDiff = (
    config: PsinodeConfig,
    configForm: UseFormReturn<PsinodeConfig, any>
) => {
    const result = { ...config };
    const oldDefaults = configForm.formState.defaultValues as PsinodeConfig;
    const userValues = configForm.getValues();
    result.services = resolveListDiff(
        oldDefaults.services,
        result.services,
        userValues.services,
        (lhs, rhs) => lhs.host == rhs.host && lhs.root == rhs.root
    );
    result.listen = resolveListDiff(
        oldDefaults.listen,
        result.listen.map(readListen),
        userValues.listen,
        (lhs, rhs) => lhs.protocol == rhs.protocol && lhs.text == rhs.text
    );
    result.loggers = readLoggers(result.loggers);
    result.admin = result.admin ? result.admin : "";
    let newState = mergeConfig(oldDefaults, result, userValues);
    if (
        userValues.services.length > 0 &&
        emptyService(userValues.services.at(-1)!)
    ) {
        result.services = [...result.services, userValues.services.at(-1)!];
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
};
