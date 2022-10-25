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
    register: (name: keyof LogConfig) => any;
    watch: (name: keyof LogConfig) => string | undefined;
    remove: () => void;
};

export const Logger = ({ name, register, watch, remove }: LoggerProps) => {
    const type_ = watch("type");
    return (
        <fieldset className="logger-control">
            <legend>{name}</legend>
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
                disabled={type_ != "file"}
                {...register("filename")}
            />
            <Form.Input
                label="Target File Name"
                disabled={type_ != "file"}
                {...register("target")}
            />
            <Form.Input
                type="number"
                label="File Rotation Size"
                disabled={type_ != "file"}
                {...register("rotationSize")}
            />
            <Form.Input
                label="File Rotation Time"
                disabled={type_ != "file"}
                {...register("rotationTime")}
            />
            <Form.Input
                type="number"
                label="Max Total File Size"
                disabled={type_ != "file"}
                {...register("maxSize")}
            />
            <Form.Input
                type="number"
                label="Max Total Files"
                disabled={type_ != "file"}
                {...register("maxFiles")}
            />
            <fieldset disabled={type_ != "file"}>
                <Form.Checkbox
                    label="Flush every record"
                    disabled={type_ != "file"}
                    {...register("flush")}
                />
            </fieldset>
            <Form.Input
                label="Socket Path"
                disabled={type_ != "local"}
                {...register("path")}
            />
        </fieldset>
    );
};

export default { Logger, readLoggers };
