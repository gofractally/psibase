import { Trash } from "lucide-react";
import { RegisterOptions, UseFormRegisterReturn } from "react-hook-form";

import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

import { LogConfig } from "./interfaces";

interface LoggerProps {
    loggerKey: string;
    register: (
        name: keyof LogConfig,
        options?: RegisterOptions,
    ) => UseFormRegisterReturn;
    watch: (name: keyof LogConfig) => string | boolean | undefined;
    remove: () => void;
}

const loggerOptionClass =
    "focus:bg-accent focus:text-accent-foreground flex w-full cursor-default select-none items-center rounded-sm py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export const Logger = ({ loggerKey, register, watch, remove }: LoggerProps) => {
    const type_ = watch("type") as string;
    return (
        <fieldset className="bg-muted flex flex-col gap-2 rounded-md p-3">
            <div className="flex justify-between py-2">
                <legend className="scroll-m-20 text-2xl font-semibold tracking-tight">
                    {loggerKey}
                </legend>
                <Button size="sm" variant="outline" onClick={remove}>
                    <Trash size={20} />
                </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="gap-1.5">
                    <Label>Type</Label>
                    <select
                        {...register("type")}
                        className="bg-background ring-offset-background placeholder:text-muted-foreground focus:ring-ring flex h-10  w-full items-center justify-between rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <option value="console" className={loggerOptionClass}>
                            Console
                        </option>
                        <option value="file" className={loggerOptionClass}>
                            File
                        </option>
                        <option value="local" className={loggerOptionClass}>
                            Local socket
                        </option>
                        <option value="pipe" className={loggerOptionClass}>
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
                <input
                    className="border-primary ring-offset-background focus-visible:ring-ring data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground peer h-4 w-4 shrink-0 rounded-sm border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    type="checkbox"
                    {...register("flush", { disabled: type_ != "file" })}
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
