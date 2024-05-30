import { RegisterOptions } from "react-hook-form";
import { Form } from "../components/form";
// import { Button } from "@/components/ui/button";
import { LogConfig } from "./interfaces";

interface LoggerProps {
    loggerKey: string;
    register: (name: keyof LogConfig, options?: RegisterOptions) => any;
    watch: (name: keyof LogConfig) => string | boolean | undefined;
    remove: () => void;
}

export const Logger = ({ loggerKey, register, watch, remove }: LoggerProps) => {
    const type_ = watch("type") as string;
    return (
        <fieldset className="logger-control p-2">
            <div className="flex justify-between">
                <legend className="text-2xl">{loggerKey}</legend>
                {/* <Button onClick={remove}>Remove</Button> */}
            </div>

            <Form.Select label="Type" {...register("type")}>
                <option value="">--Choose Logger Type--</option>
                <option value="console">Console</option>
                <option value="file">File</option>
                <option value="local">Local Socket</option>
                <option value="pipe">Pipe</option>
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
            <Form.Input
                label="Command"
                {...register("command", { disabled: type_ != "pipe" })}
            />
        </fieldset>
    );
};
