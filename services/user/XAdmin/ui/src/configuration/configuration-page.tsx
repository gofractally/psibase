import { useEffect, useState } from "react";
import { RegisterOptions, useFieldArray, useForm } from "react-hook-form";

import { Button, Form, Service } from "../components";
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
import { Divider } from "../components/divider";

interface ConfigurationPageProps {
    config?: PsinodeConfig;
    refetchConfig: () => void;
}

export const ConfigurationPage = ({
    config,
    refetchConfig,
}: ConfigurationPageProps) => {
    const [configPutError, setConfigPutError] = useState<string>();

    const configForm = useForm<PsinodeConfig>({
        defaultValues: initialConfigForm(),
    });
    configForm.formState.dirtyFields;

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

    const onConfig = async (input: PsinodeConfig) => {
        try {
            setConfigPutError(undefined);
            for (let service of input.services) {
                if (service.host == "") {
                    service.host = defaultService(service.root);
                }
            }
            const result = await putJson(
                "/native/admin/config",
                writeConfig(input)
            );
            if (result.ok) {
                configForm.reset(input);
                refetchConfig();
            } else {
                setConfigPutError(await result.text());
            }
        } catch (e) {
            console.error("error", e);
            setConfigPutError("Failed to write /native/admin/config");
        }
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
            <h1>Configuration</h1>
            {!config ? (
                <p>Unable to load config</p>
            ) : (
                <form onSubmit={configForm.handleSubmit(onConfig)}>
                    <Form.Checkbox
                        label="Accept incoming P2P connections"
                        {...configForm.register("p2p")}
                    />
                    <Form.Input
                        label="Block Producer Name"
                        {...configForm.register("producer")}
                    />
                    <Form.Input label="Host" {...configForm.register("host")} />
                    <table>
                        <thead>
                            <tr>
                                <th>Port (requires restart)</th>
                            </tr>
                        </thead>
                        <tbody>
                        {listeners.fields.map((l, idx: number) => (
                            <tr key={l.key}>
                                <td>
                                    <input
                                        className="w-full border bg-white px-3 py-2 text-base text-gray-900 outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-gray-500"
                                        {...configForm.register(
                                            `listen.${idx}.text`
                                        )}
                                    />
                                </td>
                                <td>
                                    <select
                                        {...configForm.register(
                                            `listen.${idx}.protocol`
                                        )}
                                    >
                                        <option value="http">HTTP</option>
                                        <option value="https">HTTPS</option>
                                        <option value="local">
                                            Local Socket
                                        </option>
                                    </select>
                                </td>
                                <td>
                                    <Button
                                        onClick={() => listeners.remove(idx)}
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
                                    onClick={onAddNewListenerClick}
                                >
                                    New Listener
                                </Button>
                            </td>
                        </tr>
                        </tbody>
                    </table>

                    <Divider />

                    <h2>Loggers</h2>
                    {loggers &&
                        Object.entries(loggers).map(([name, _contents]) => (
                            <Logger
                                key={name}
                                loggerKey={name}
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
                        ))}
                    <Button className="mt-4" onClick={onAddNewLoggerClick}>
                        New Logger
                    </Button>

                    <Divider />

                    <h2>Builtin Services</h2>
                    <fieldset>
                        <table className="service-table">
                            <thead>
                                <tr>
                                    <th>Hostname</th>
                                    <th>Path</th>
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

                    <fieldset className="mt-4">
                        <legend>Access to admin API</legend>
                        <Form.Radio
                            {...configForm.register("admin")}
                            value="static:*"
                            label="Builtin services only (recommended)"
                        />
                        <Form.Radio
                            {...configForm.register("admin")}
                            value="*"
                            label="All services (not recommended)"
                        />
                        <Form.Radio
                            {...configForm.register("admin")}
                            value=""
                            label="Disabled"
                        />
                    </fieldset>

                    <Button
                        className="my-4"
                        size="xl"
                        isSubmit
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
