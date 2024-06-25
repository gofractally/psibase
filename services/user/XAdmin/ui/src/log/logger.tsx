import { Controller, RegisterOptions } from "react-hook-form";
import { LogConfig } from "./interfaces";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface LoggerProps {
    loggerKey: string;
    control: any;
    register: (name: keyof LogConfig, options?: RegisterOptions) => any;
    watch: (name: keyof LogConfig) => string | boolean | undefined;
    remove: () => void;
}

export const Logger = ({
    loggerKey,
    control,
    register,
    watch,
    remove,
}: LoggerProps) => {
    const type_ = watch("type") as string;
    return (
        <fieldset className="flex flex-col gap-2 rounded-md bg-muted p-3">
            <div className="flex justify-between py-2">
                <legend className="scroll-m-20 text-2xl font-semibold tracking-tight">
                    {loggerKey}
                </legend>
                <Button size="sm" variant="default" onClick={remove}>
                    Remove
                </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="gap-1.5">
                    <Label>Type</Label>
                    <select
                        {...register("type")}
                        className="flex h-10 w-full items-center justify-between rounded-md  bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <option value="console" className="logger-option">
                            Console
                        </option>
                        <option value="file" className="logger-option">
                            File
                        </option>
                        <option value="local" className="logger-option">
                            Local socket
                        </option>
                        <option value="pipe" className="logger-option">
                            Pipe
                        </option>
                    </select>
                </div>

                <div className="gap-1.5">
                    <Label>Filter</Label>
                    <Input {...register("filter")} />
                </div>
            </div>

            <div className="gap-1.5">
                <Label>Format</Label>
                <Input {...register("format")} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className={cn("gap-1.5", { hidden: type_ != "file" })}>
                    <Label>File Name</Label>
                    <Input
                        {...register("filename", { disabled: type_ != "file" })}
                    />
                </div>

                <div className={cn("gap-1.5", { hidden: type_ != "file" })}>
                    <Label>Target File Name</Label>
                    <Input
                        {...register("target", { disabled: type_ != "file" })}
                    />
                </div>

                <div className={cn("gap-1.5", { hidden: type_ != "file" })}>
                    <Label>File Rotation Size</Label>
                    <Input
                        type="number"
                        {...register("rotationSize", {
                            disabled: type_ != "file",
                        })}
                    />
                </div>

                <div className={cn("gap-1.5", { hidden: type_ != "file" })}>
                    <Label>File Rotation Time</Label>
                    <Input
                        {...register("rotationTime", {
                            disabled: type_ != "file",
                        })}
                    />
                </div>

                <div className={cn("gap-1.5", { hidden: type_ != "file" })}>
                    <Label>Max Total File Size</Label>
                    <Input
                        type="number"
                        {...register("maxSize", { disabled: type_ != "file" })}
                    />
                </div>

                <div className={cn("gap-1.5", { hidden: type_ != "file" })}>
                    <Label>Max Total Files</Label>
                    <Input
                        type="number"
                        {...register("maxFiles", { disabled: type_ != "file" })}
                    />
                </div>
            </div>

            <div
                className={cn("flex justify-between py-4", {
                    hidden: type_ != "file",
                })}
            >
                <Label>Flush every record</Label>
                <Controller
                    name="flush"
                    control={control}
                    disabled={type_ != "file"}
                    render={({ field }) => (
                        <Checkbox
                            disabled={field.disabled}
                            checked={field.value}
                            onCheckedChange={(checked) =>
                                field.onChange(checked)
                            }
                        />
                    )}
                />
            </div>

            <div className={cn("gap-1.5", { hidden: type_ != "local" })}>
                <Label>Socket Path</Label>
                <Input {...register("path", { disabled: type_ != "local" })} />
            </div>
            <div className={cn("gap-1.5", { hidden: type_ != "pipe" })}>
                <Label>Command</Label>
                <Input
                    {...register("command", { disabled: type_ != "pipe" })}
                />
            </div>
        </fieldset>
    );
};
