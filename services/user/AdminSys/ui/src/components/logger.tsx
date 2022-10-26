import { RegisterOptions } from "react-hook-form";
import { Form } from "./form";
import { Button } from "./button";
import "../styles/logger.css";

export type LogConfig = {
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

export function readLoggers(config: { [index: string]: LogConfig }): {
    [index: string]: LogConfig;
} {
    const result: any = {};
    if (config !== undefined) {
        for (const key in config) {
            result[key] = readLogger(config[key]);
        }
    }
    return result;
}

type LoggerProps = {
    name: string;
    register: (name: keyof LogConfig, options?: RegisterOptions) => any;
    watch: (name: keyof LogConfig) => string | boolean | undefined;
    remove: () => void;
};

export const Logger = ({ name, register, watch, remove }: LoggerProps) => {
    const type_ = watch("type") as string;
    return (
        <fieldset className="logger-control">
            <legend>Logger</legend>
            <Button onClick={remove}>Remove</Button>
            <Form.Select label="Type" {...register("type")}>
                <option value="">--Choose Logger Type--</option>
                <option value="console">Console</option>
                <option value="file">File</option>
                <option value="local">Local Socket</option>
            </Form.Select>

            <Form.Input label="Filter" {...register("filter")} />
            <Form.Input label="Format" {...register("format")} />
            <Form.Input
                label="File Name"
                {...register("filename", { disabled: type_ != "file" })}
            />
            <Form.Input
                label="Target File Name"
                {...register("target", { disabled: type_ != "file" })}
            />
            <Form.Input
                type="number"
                label="File Rotation Size"
                {...register("rotationSize", { disabled: type_ != "file" })}
            />
            <Form.Input
                label="File Rotation Time"
                {...register("rotationTime", { disabled: type_ != "file" })}
            />
            <Form.Input
                type="number"
                label="Max Total File Size"
                {...register("maxSize", { disabled: type_ != "file" })}
            />
            <Form.Input
                type="number"
                label="Max Total Files"
                {...register("maxFiles", { disabled: type_ != "file" })}
            />
            <fieldset disabled={type_ != "file"}>
                <Form.Checkbox
                    label="Flush every record"
                    {...register("flush", { disabled: type_ != "file" })}
                />
            </fieldset>
            <Form.Input
                label="Socket Path"
                {...register("path", { disabled: type_ != "local" })}
            />
        </fieldset>
    );
};

export default { Logger, readLoggers };
