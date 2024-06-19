import { useEffect, useState } from "react";
import {
    RegisterOptions,
    useFieldArray,
    useForm,
    Controller,
} from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Service } from "../components";
import { PsinodeConfig, ServiceConfig } from "./interfaces";
import {
    defaultService,
    emptyService,
    initialConfigForm,
    resolveConfigFormDiff,
    writeConfig,
    newId,
} from "./utils";
import { putJson } from "../helpers";
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

export const ConfigurationPage = () => {
    const { data: config, refetch: refetchConfig } = useConfig();

    const configForm = useForm<PsinodeConfig>({
        defaultValues: initialConfigForm(),
    });

    const listeners = useFieldArray({
        control: configForm.control,
        name: "listen",
    });

    const services = useFieldArray({
        control: configForm.control,
        name: "services",
    });

    useEffect(() => {
        if (config) {
            resolveConfigFormDiff(config, configForm);
        }
    }, [config]);

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

    const { mutateAsync, error: configPutError } = useConfigUpdate();

    const onConfig = async (input: PsinodeConfig) => {
        for (let service of input.services) {
            if (service.host == "") {
                service.host = defaultService(service.root);
            }
        }
        mutateAsync(writeConfig(input));
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
        listeners.append({ key: newId(), text: "", protocol: "http" });
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
                    <Controller
                        name="p2p"
                        control={configForm.control}
                        render={({ field }) => (
                            <div className="my-6 flex items-center space-x-2">
                                <Switch
                                    onCheckedChange={field.onChange}
                                    checked={field.value}
                                />
                                <Label>Accept incoming P2P connections</Label>
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
                        <div className="grid w-full items-center gap-1.5">
                            <Label>Host</Label>
                            <Input {...configForm.register("host")} />
                        </div>
                    </div>
                    <h4 className="my-4 scroll-m-20 text-xl font-semibold tracking-tight">
                        Ports
                    </h4>
                    <Label>Requires restart</Label>
                    <table>
                        <tbody>
                            {listeners.fields.map((l, idx: number) => (
                                <tr key={l.key}>
                                    <td>
                                        <Input
                                            type="number"
                                            {...configForm.register(
                                                `listen.${idx}.text`
                                            )}
                                        />
                                    </td>
                                    <td>
                                        <Controller
                                            name={`listen.${idx}.protocol`}
                                            control={configForm.control}
                                            render={({ field }) => (
                                                <Select
                                                    value={field.value}
                                                    onValueChange={(value) =>
                                                        field.onChange(value)
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
                                                            Local socket
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
                                                listeners.remove(idx)
                                            }
                                        >
                                            Remove
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                            <tr>
                                <td>
                                    <Button
                                        className="mt-4"
                                        type="button"
                                        onClick={onAddNewListenerClick}
                                    >
                                        New Listener
                                    </Button>
                                </td>
                            </tr>
                        </tbody>
                    </table>

                    <h2 className="my-3 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0">
                        Loggers
                    </h2>
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
                                            handleLoggerFieldWatch(name, field)
                                        }
                                        remove={() => handleLoggerRemove(name)}
                                    />
                                )
                            )}
                        </div>
                    )}
                    <Button className="mt-4" onClick={onAddNewLoggerClick}>
                        New Logger
                    </Button>
                    <h2 className="my-3 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0">
                        Built-in Services
                    </h2>
                    <fieldset>
                        <table className="w-full">
                            <thead>
                                <tr>
                                    <th className="text-left">Hostname</th>
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
                                    onValueChange={(e) => field.onChange(e)}
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
                                        <RadioGroupItem value="*" id="r2" />
                                        <Label htmlFor="r2">
                                            All services{" "}
                                            <span className="text-muted-foreground">
                                                (not recommended)
                                            </span>
                                        </Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="" id="r3" />
                                        <Label htmlFor="r3">Disabled</Label>
                                    </div>
                                </RadioGroup>
                            </fieldset>
                        )}
                    />

                    <Button
                        className="my-4"
                        size="lg"
                        type="submit"
                        disabled={!configForm.formState.isDirty}
                    >
                        Save Changes
                    </Button>
                </form>
            )}
            {configPutError && <div>{configPutError}</div>}
        </>
    );
};
