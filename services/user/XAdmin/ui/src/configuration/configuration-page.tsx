import {
    RegisterOptions,
    useFieldArray,
    useForm,
    Controller,
} from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Service } from "../components";
import {
    PsinodeConfigUI,
    PsinodeConfigUpdate,
    ServiceConfig,
} from "./interfaces";
import { defaultService, writeConfig, newId } from "./utils";
import { Logger } from "../log/logger";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useConfig, useConfigUpdate } from "../hooks/useConfig";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash } from "lucide-react";

export const ConfigurationPage = () => {
    const { data: config, isLoading, isError } = useConfig();

    const { mutateAsync } = useConfigUpdate();

    const handleSubmit = async (config: PsinodeConfigUpdate) => {
        void (await mutateAsync(config));
        return config;
    };

    if (isLoading) return <div>Loading..</div>;
    if (!config || isError) return <div>Error loading config</div>;

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

    console.log(configForm.formState, "is state.");

    const listeners = useFieldArray({
        control: configForm.control,
        name: "listen",
    });

    const services = useFieldArray({
        control: configForm.control,
        name: "services",
    });

    const hosts = useFieldArray({
        control: configForm.control,
        name: "hosts",
    });

    const onConfig = async (input: PsinodeConfigUI) => {
        for (let service of input.services) {
            if (service.host == "") {
                service.host = defaultService(service.root);
            }
        }
        void (await onSubmit(writeConfig(input)));
        configForm.reset(input);
    };

    const addNewService = () => {
        services.append({
            host: "",
            key: Math.floor(Math.random() * 100000).toString(),
            root: "",
        });
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
        options?: RegisterOptions
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
                <form
                    onSubmit={configForm.handleSubmit(onConfig)}
                    className="px-2"
                >
                    <Tabs defaultValue="connections" className="">
                        <TabsList>
                            <TabsTrigger value="connections">
                                Connections
                            </TabsTrigger>
                            <TabsTrigger value="logs">Logs</TabsTrigger>
                            <TabsTrigger value="services">Services</TabsTrigger>
                        </TabsList>
                        <TabsContent value="connections">
                            <Controller
                                name="p2p"
                                control={configForm.control}
                                render={({ field }) => (
                                    <div className="my-6 flex items-center space-x-2">
                                        <Switch
                                            onCheckedChange={field.onChange}
                                            checked={field.value}
                                        />
                                        <Label>
                                            Accept incoming P2P connections
                                        </Label>
                                    </div>
                                )}
                            />
                            <div className="flex justify-between gap-4">
                                <div className="grid w-full items-center gap-1.5">
                                    <Label htmlFor="blockProducerName">
                                        Block producer name
                                    </Label>
                                    <Input
                                        id="blockProducerName"
                                        {...configForm.register("producer")}
                                    />
                                </div>
                            </div>
                            <div>
                                <h4 className="my-4 scroll-m-20 text-xl font-semibold tracking-tight">
                                    Hosts
                                </h4>

                                <table>
                                    <thead>
                                        <tr>
                                            <th className="flex flex-row-reverse ">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        onAddNewHostClick();
                                                    }}
                                                >
                                                    +
                                                </Button>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {hosts.fields.map((h, idx: number) => (
                                            <tr key={h.key}>
                                                <td>
                                                    <Input
                                                        type="text"
                                                        {...configForm.register(
                                                            `hosts.${idx}.host`
                                                        )}
                                                    />
                                                </td>
                                                <td>
                                                    <Button
                                                        variant="secondary"
                                                        onClick={() =>
                                                            hosts.remove(idx)
                                                        }
                                                    >
                                                        <Trash size={16} />
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div>
                                <h4 className="my-4 scroll-m-20 text-xl font-semibold tracking-tight">
                                    Ports
                                </h4>

                                <table>
                                    <thead>
                                        <tr>
                                            <th colSpan={2}>
                                                <Label>Requires restart</Label>
                                            </th>
                                            <th className="flex flex-row-reverse ">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        onAddNewListenerClick();
                                                    }}
                                                >
                                                    +
                                                </Button>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {listeners.fields.map(
                                            (l, idx: number) => (
                                                <tr key={l.key}>
                                                    <td>
                                                        <Input
                                                            type="number"
                                                            {...configForm.register(
                                                                `listen.${idx}.port`
                                                            )}
                                                        />
                                                    </td>
                                                    <td>
                                                        <Controller
                                                            name={`listen.${idx}.protocol`}
                                                            control={
                                                                configForm.control
                                                            }
                                                            render={({
                                                                field,
                                                            }) => (
                                                                <Select
                                                                    value={
                                                                        field.value
                                                                    }
                                                                    onValueChange={(
                                                                        value
                                                                    ) =>
                                                                        field.onChange(
                                                                            value
                                                                        )
                                                                    }
                                                                >
                                                                    <SelectTrigger className="w-[180px]">
                                                                        <SelectValue placeholder="Theme" />
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
                                                    </td>
                                                    <td>
                                                        <Button
                                                            variant="secondary"
                                                            onClick={() =>
                                                                listeners.remove(
                                                                    idx
                                                                )
                                                            }
                                                        >
                                                            <Trash size={16} />
                                                        </Button>
                                                    </td>
                                                </tr>
                                            )
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </TabsContent>
                        <TabsContent value="logs">
                            <div className="flex justify-between">
                                <h2 className="my-3 scroll-m-20 pb-2 text-3xl font-semibold tracking-tight first:mt-0">
                                    Loggers
                                </h2>
                                <div>
                                    <Button
                                        variant="secondary"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            onAddNewLoggerClick();
                                        }}
                                    >
                                        <Plus size={20} className="" />
                                    </Button>
                                </div>
                            </div>
                            {loggers && (
                                <div className="flex flex-col gap-4">
                                    {Object.entries(loggers).map(
                                        ([name, _contents]) => (
                                            <Logger
                                                key={name}
                                                loggerKey={name}
                                                control={configForm.control}
                                                register={(field, options) =>
                                                    handleLoggerFieldRegister(
                                                        name,
                                                        field,
                                                        options
                                                    )
                                                }
                                                watch={(field) =>
                                                    handleLoggerFieldWatch(
                                                        name,
                                                        field
                                                    )
                                                }
                                                remove={() =>
                                                    handleLoggerRemove(name)
                                                }
                                            />
                                        )
                                    )}
                                </div>
                            )}
                        </TabsContent>
                        <TabsContent value="services">
                            <div className="flex justify-between">
                                <h2 className="my-3 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0">
                                    Built-in Services
                                </h2>
                                <div>
                                    <Button
                                        variant="secondary"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            addNewService();
                                        }}
                                    >
                                        <Plus size={20} className="" />
                                    </Button>
                                </div>
                            </div>

                            <fieldset>
                                <table className="w-full">
                                    <thead>
                                        <tr>
                                            <th className="text-left">
                                                Hostname
                                            </th>
                                            <th className="text-left">Path</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {services.fields.map((field, index) => (
                                            <Service
                                                key={field.key}
                                                register={(name, options) =>
                                                    configForm.register(
                                                        `services.${name}`,
                                                        // @ts-expect-error eeej
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
                                            />
                                        ))}
                                    </tbody>
                                </table>
                            </fieldset>
                            <Controller
                                name="admin"
                                control={configForm.control}
                                render={({ field }) => (
                                    <fieldset className="mt-4">
                                        <Label>Access to admin API</Label>
                                        <RadioGroup
                                            value={field.value}
                                            onValueChange={(e) =>
                                                field.onChange(e)
                                            }
                                        >
                                            <div className="flex items-center space-x-2">
                                                <RadioGroupItem
                                                    value="static:*"
                                                    id="r1"
                                                />
                                                <Label htmlFor="r1">
                                                    Builtin services only{" "}
                                                    <span className="text-muted-foreground">
                                                        (recommended)
                                                    </span>
                                                </Label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <RadioGroupItem
                                                    value="*"
                                                    id="r2"
                                                />
                                                <Label htmlFor="r2">
                                                    All services{" "}
                                                    <span className="text-muted-foreground">
                                                        (not recommended)
                                                    </span>
                                                </Label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <RadioGroupItem
                                                    value=""
                                                    id="r3"
                                                />
                                                <Label htmlFor="r3">
                                                    Disabled
                                                </Label>
                                            </div>
                                        </RadioGroup>
                                    </fieldset>
                                )}
                            />
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
