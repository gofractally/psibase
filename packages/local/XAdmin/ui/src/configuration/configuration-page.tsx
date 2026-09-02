import { Plus, Trash } from "lucide-react";
import {
    Controller,
    RegisterOptions,
    useFieldArray,
    useForm,
} from "react-hook-form";

import { PageHeading } from "@/components/page-heading";

import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@shared/shadcn/ui/tabs";

import { useConfig, useConfigUpdate } from "../hooks/use-config";
import { useServerSpecs } from "../hooks/use-server-specs";
import { Logger } from "../log/logger";
import { PsinodeConfigUI, PsinodeConfigUpdate } from "./interfaces";
import { newId, writeConfig } from "./utils";

const getHumanFriendlyNumber = (
    value: number,
    baseUnit: string,
    decimals: number = 0,
): string => {
    if (value >= 1e15) {
        return `${(value / 1e15).toFixed(decimals)} P${baseUnit}`;
    }
    if (value >= 1e12) {
        return `${(value / 1e12).toFixed(decimals)} T${baseUnit}`;
    }
    if (value >= 1e9) {
        return `${(value / 1e9).toFixed(decimals)} G${baseUnit}`;
    }
    if (value >= 1e6) {
        return `${(value / 1e6).toFixed(decimals)} M${baseUnit}`;
    }
    if (value >= 1e3) {
        return `${(value / 1e3).toFixed(decimals)} K${baseUnit}`;
    }
    return `${Math.round(value)} ${baseUnit}`;
};

const NodeSpecsContent = () => {
    const { data: serverSpecs, isLoading: isLoadingSpecs } = useServerSpecs();
    const ramBytes = serverSpecs?.recommendedMinMemoryBytes;

    return (
        <div className="space-y-4">
            <div className="space-y-4 rounded-lg border p-4">
                {isLoadingSpecs ? (
                    <div className="space-y-3">
                        <Skeleton className="h-6 w-32" />
                        <Skeleton className="h-6 w-32" />
                        <Skeleton className="h-6 w-32" />
                    </div>
                ) : (
                    <>
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">
                                Bandwidth:
                            </span>
                            <span className="text-sm">
                                {serverSpecs
                                    ? getHumanFriendlyNumber(
                                          serverSpecs.bandwidthBps,
                                          "bps",
                                          1,
                                      )
                                    : "N/A"}
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">
                                Storage:
                            </span>
                            <span className="text-sm">
                                {serverSpecs
                                    ? getHumanFriendlyNumber(
                                          serverSpecs.storageBytes,
                                          "B",
                                      )
                                    : "N/A"}
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">RAM:</span>
                            <span className="text-sm">
                                {ramBytes
                                    ? getHumanFriendlyNumber(ramBytes, "B")
                                    : "N/A"}
                            </span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export const ConfigurationPage = () => {
    const { data: config, isLoading, isError } = useConfig();

    const { mutateAsync } = useConfigUpdate();

    const handleSubmit = async (config: PsinodeConfigUpdate) => {
        void (await mutateAsync(config));
        return config;
    };

    if (isLoading) {
        return (
            <div className="space-y-4">
                <PageHeading
                    title="Setup"
                    description="Node identity, listeners, and logging."
                />
                <Skeleton className="h-8 w-72" />
                <Skeleton className="h-40 w-full" />
            </div>
        );
    }
    if (!config || isError) {
        return (
            <div>
                <PageHeading title="Setup" />
                <p className="text-muted-foreground text-sm">
                    Error loading config.
                </p>
            </div>
        );
    }

    return <ConfigurationForm config={config} onSubmit={handleSubmit} />;
};
export const ConfigurationForm = ({
    config,
    onSubmit,
}: {
    config: PsinodeConfigUI;
    onSubmit: (config: PsinodeConfigUpdate) => Promise<PsinodeConfigUpdate>;
}) => {
    const configForm = useForm<PsinodeConfigUI>({
        defaultValues: config,
    });

    const listeners = useFieldArray({
        control: configForm.control,
        name: "listen",
    });

    const hosts = useFieldArray({
        control: configForm.control,
        name: "hosts",
    });

    const onConfig = async (input: PsinodeConfigUI) => {
        void (await onSubmit(writeConfig(input)));
        configForm.reset(input);
    };

    const onAddNewLoggerClick = () => {
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
            "~" + current.toString(16).toUpperCase().padStart(8, "0")
        ] = {
            type: "",
            filter: "",
            format: "",
        };
        configForm.reset(state, {
            keepDefaultValues: true,
        });
    };

    const handleLoggerFieldRegister = (
        loggerName: string,
        field: string,
        options?: RegisterOptions,
        // @ts-expect-error eee
    ) => configForm.register(`loggers.${loggerName}.${field}`, options);

    const handleLoggerRemove = (loggerName: string) => {
        // This differs from unregister by preserving the loggers
        // subobject even if it becomes empty
        const state = configForm.getValues();
        delete state.loggers[loggerName];
        configForm.reset(state, {
            keepDefaultValues: true,
        });
    };

    const handleLoggerFieldWatch = (loggerName: string, field: string) =>
        configForm.watch(`loggers.${loggerName}.${field}`);

    const loggers = configForm.watch("loggers");

    const onAddNewListenerClick = () => {
        listeners.append({ key: newId(), port: undefined, protocol: "http" });
    };

    const onAddNewHostClick = () => {
        hosts.append({ key: newId(), host: "" });
    };

    return (
        <>
            {!config ? (
                <p>Unable to load config</p>
            ) : (
                <form onSubmit={configForm.handleSubmit(onConfig)}>
                    <PageHeading
                        title="Setup"
                        description="Node identity, listeners, and logging."
                    />
                    <Tabs defaultValue="connections">
                        <TabsList>
                            <TabsTrigger value="connections">
                                Connections
                            </TabsTrigger>
                            <TabsTrigger value="logs">Logs</TabsTrigger>
                            <TabsTrigger value="node-specs">
                                Node Specs
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="connections" className="space-y-6">
                            <div className="grid w-full max-w-md items-center gap-1.5">
                                <Label htmlFor="blockProducerName">
                                    Block producer name
                                </Label>
                                <Input
                                    id="blockProducerName"
                                    {...configForm.register("producer")}
                                />
                            </div>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <h4 className="text-sm font-medium">
                                        Hosts
                                    </h4>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={onAddNewHostClick}
                                    >
                                        <Plus />
                                        Add host
                                    </Button>
                                </div>
                                {hosts.fields.length === 0 ? (
                                    <p className="text-muted-foreground text-sm">
                                        No hosts configured.
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {hosts.fields.map((h, idx: number) => (
                                            <div
                                                key={h.key}
                                                className="flex gap-2"
                                            >
                                                <Input
                                                    type="text"
                                                    {...configForm.register(
                                                        `hosts.${idx}.host`,
                                                    )}
                                                />
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() =>
                                                        hosts.remove(idx)
                                                    }
                                                    aria-label="Remove host"
                                                >
                                                    <Trash />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h4 className="text-sm font-medium">
                                            Ports
                                        </h4>
                                        <p className="text-muted-foreground text-xs">
                                            Changing ports requires a restart.
                                        </p>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={onAddNewListenerClick}
                                    >
                                        <Plus />
                                        Add port
                                    </Button>
                                </div>
                                {listeners.fields.length === 0 ? (
                                    <p className="text-muted-foreground text-sm">
                                        No ports configured.
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {listeners.fields.map(
                                            (l, idx: number) => (
                                                <div
                                                    key={l.key}
                                                    className="flex flex-wrap gap-2"
                                                >
                                                    <Input
                                                        type="number"
                                                        className="min-w-28 flex-1"
                                                        {...configForm.register(
                                                            `listen.${idx}.port`,
                                                        )}
                                                    />
                                                    <Controller
                                                        name={`listen.${idx}.protocol`}
                                                        control={
                                                            configForm.control
                                                        }
                                                        render={({ field }) => (
                                                            <Select
                                                                value={
                                                                    field.value
                                                                }
                                                                onValueChange={
                                                                    field.onChange
                                                                }
                                                            >
                                                                <SelectTrigger className="w-[180px]">
                                                                    <SelectValue placeholder="Protocol" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="http">
                                                                        HTTP
                                                                    </SelectItem>
                                                                    <SelectItem value="https">
                                                                        HTTPS
                                                                    </SelectItem>
                                                                    <SelectItem value="socket">
                                                                        Local
                                                                        socket
                                                                    </SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        )}
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() =>
                                                            listeners.remove(
                                                                idx,
                                                            )
                                                        }
                                                        aria-label="Remove port"
                                                    >
                                                        <Trash />
                                                    </Button>
                                                </div>
                                            ),
                                        )}
                                    </div>
                                )}
                            </div>
                        </TabsContent>
                        <TabsContent value="logs">
                            <div className="mb-4 flex items-center justify-between gap-3">
                                <h2 className="text-sm font-medium">Loggers</h2>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={onAddNewLoggerClick}
                                >
                                    <Plus />
                                    Add logger
                                </Button>
                            </div>
                            {loggers && (
                                <div className="flex flex-col gap-4">
                                    {Object.entries(loggers).map(([name]) => (
                                        <Logger
                                            key={name}
                                            loggerKey={name}
                                            register={(field, options) =>
                                                handleLoggerFieldRegister(
                                                    name,
                                                    field,
                                                    options,
                                                )
                                            }
                                            watch={(field) =>
                                                handleLoggerFieldWatch(
                                                    name,
                                                    field,
                                                )
                                            }
                                            remove={() =>
                                                handleLoggerRemove(name)
                                            }
                                        />
                                    ))}
                                </div>
                            )}
                        </TabsContent>

                        <TabsContent value="node-specs">
                            <NodeSpecsContent />
                        </TabsContent>
                    </Tabs>

                    <Button
                        className="my-4"
                        size="lg"
                        type="submit"
                        disabled={
                            !configForm.formState.isDirty ||
                            configForm.formState.isLoading
                        }
                    >
                        {configForm.formState.isLoading
                            ? "Saving"
                            : "Save changes"}
                    </Button>
                </form>
            )}
        </>
    );
};
