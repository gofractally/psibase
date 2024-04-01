import { LogConfig } from "./interfaces";

export function readLogger(config: LogConfig): LogConfig {
    const result: any = { ...config };
    for (const key of [
        "filename",
        "target",
        "rotationSize",
        "rotationTime",
        "maxSize",
        "maxFiles",
        "path",
        "flush",
    ]) {
        if (!(key in result)) {
            result[key] = undefined;
        }
    }
    if (result.type == "file") {
        if (result.filename === undefined) {
            result.filename = "";
        }
        if (result.target === undefined) {
            result.target = "";
        }
        if (result.rotationSize === undefined) {
            result.rotationSize = "";
        }
        if (result.rotationTime === undefined) {
            result.rotationTime = "";
        }
        if (result.maxSize === undefined) {
            result.maxSize = "";
        }
        if (result.maxFiles === undefined) {
            result.maxFiles = "";
        }
        if (result.flush === undefined) {
            result.flush = false;
        }
    }
    if (result.type == "local") {
        if (result.path === undefined) {
            result.path = "";
        }
    }
    return result;
}

// a . or a leading digit causes problems for react-hook-form
function escapeKey(k: string): string {
    let prefix = "";
    if (/^\d/.test(k)) {
        prefix = "\\";
    }
    return prefix + k.replace("\\", "\\\\").replace(".", "\\p");
}

export function readLoggers(config: { [index: string]: LogConfig }): {
    [index: string]: LogConfig;
} {
    const result: any = {};
    if (config !== undefined) {
        for (const key in config) {
            result[escapeKey(key)] = readLogger(config[key]);
        }
    }
    return result;
}
