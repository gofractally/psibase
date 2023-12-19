import { useState, useEffect } from "react";
import { useForm, UseFormReturn } from "react-hook-form";
import { Button, Form } from "../components";
import { PsinodeConfig } from "../configuration/interfaces";
import { putJson } from "../helpers";
import {
    getJson,
    getArrayBuffer,
    postArrayBuffer,
    postArrayBufferGetJson,
} from "common/rpc.mjs";
import * as wasm from "wasm-psibase";

type InstallType = {
    installType: string;
};
type ServicesType = {
    [key: string]: boolean;
};

interface PackageMeta {
    name: string;
    description: string;
    depends: string[];
    accounts: string[];
}

interface PackageInfo extends PackageMeta {
    file: string;
    sha256: string;
}

type PackageIndex = PackageInfo[];

type PackageMap = { [key: string]: PackageInfo };

interface TypeFormProps {
    typeForm: UseFormReturn<InstallType>;
    setCurrentPage: (page: string) => void;
}

interface ServicesFormProps {
    keys: string[];
    servicesForm: UseFormReturn<ServicesType>;
    setCurrentPage: (page: string) => void;
}

interface ProducerType {
    producer: string;
}

interface ProducerFormProps {
    producerForm: UseFormReturn<ProducerType>;
    typeForm: UseFormReturn<InstallType>;
    setCurrentPage: (page: string) => void;
}

type BootState = undefined | [string, number, number] | string;

interface InstallFormProps {
    packages: string[];
    producerForm: UseFormReturn<ProducerType>;
    config?: PsinodeConfig;
    refetchConfig: () => void;
    setCurrentPage: (page: string) => void;
    setBootState: (state: BootState) => void;
}

interface BootPageProps {
    config?: PsinodeConfig;
    refetchConfig: () => void;
}

interface ProgressPageProps {
    state: BootState;
}

export const TypeForm = ({ typeForm, setCurrentPage }: TypeFormProps) => {
    return (
        <form
            onSubmit={typeForm.handleSubmit((state) => {
                if (state.installType == "full") {
                    setCurrentPage("producer");
                } else if (state.installType == "custom") {
                    setCurrentPage("services");
                }
            })}
        >
            <fieldset className="mt-4">
                <legend>Install type</legend>
                <Form.Radio
                    {...typeForm.register("installType")}
                    value="full"
                    label="Install all services"
                />
                <Form.Radio
                    {...typeForm.register("installType")}
                    value="custom"
                    label="Choose services to install"
                />
            </fieldset>
            <Button className="mt-4" isSubmit>
                Next
            </Button>
        </form>
    );
};

export const ServicesForm = ({
    keys,
    servicesForm,
    setCurrentPage,
}: ServicesFormProps) => {
    return (
        <form
            onSubmit={servicesForm.handleSubmit((state) =>
                setCurrentPage("producer")
            )}
        >
            {keys.map((name) => (
                <Form.Checkbox label={name} {...servicesForm.register(name)} />
            ))}
            <Button
                className="mt-4"
                onClick={() => {
                    setCurrentPage("type");
                }}
            >
                Back
            </Button>
            <Button className="mt-4" isSubmit>
                Next
            </Button>
        </form>
    );
};

export const ProducerForm = ({
    producerForm,
    typeForm,
    setCurrentPage,
}: ProducerFormProps) => {
    return (
        <>
            <form onSubmit={() => setCurrentPage("install")}>
                <Form.Input
                    label="Block Producer Name"
                    {...producerForm.register("producer", {
                        required: true,
                        pattern: /[-a-z0-9]+/,
                    })}
                />
                <Button
                    className="mt-4"
                    onClick={() => {
                        let installType = typeForm.getValues("installType");
                        if (installType == "full") {
                            setCurrentPage("type");
                        } else if (installType == "custom") {
                            setCurrentPage("services");
                        }
                    }}
                >
                    Back
                </Button>
                <Button
                    className="mt-4"
                    isSubmit
                    disabled={!producerForm.formState.isValid}
                >
                    Next
                </Button>
            </form>
        </>
    );
};

async function runBoot(
    packageNames: string[],
    producer: string,
    config: PsinodeConfig | undefined,
    refetchConfig: () => void,
    setBootState: (state: BootState) => void
) {
    try {
        // Set producer name
        if (config && producer !== config.producer) {
            const result = await putJson("/native/admin/config", {
                ...config,
                producer: producer,
            });
            if (result.ok) {
                refetchConfig();
            } else {
                setBootState("Failed to set producer name");
                return;
            }
        }

        // fetch packages
        let packages: ArrayBuffer[] = [];
        let i = 0;
        for (let name of packageNames) {
            setBootState(["fetch", i, packageNames.length]);
            packages.push(await getArrayBuffer(`/packages/${name}.psi`));
            i++;
        }
        // Something is wrong with the Vite proxy configuration that causes boot to intermittently (but often) fail
        // in a dev environment.
        let [boot_transactions, transactions] =
            wasm.js_create_boot_transactions(producer, packages);
        setBootState(["push", 0, transactions.length + 1]);
        await postArrayBuffer("/native/push_boot", boot_transactions.buffer);
        i = 1;
        for (const t of transactions) {
            console.log(`Pushing transaction number: ${i}`);
            setBootState(["push", i, transactions.length + 1]);
            await postArrayBufferGetJson("/native/push_transaction", t.buffer);
            i++;
        }
        setBootState("Boot successful.");
    } catch (e) {
        setBootState("Boot failed.");
        console.error(e);
    }
}

export const InstallForm = ({
    packages,
    config,
    refetchConfig,
    producerForm,
    setCurrentPage,
    setBootState,
}: InstallFormProps) => {
    let nameChange = undefined;
    let actualProducer = producerForm.getValues("producer");
    if (config && config.producer !== actualProducer) {
        nameChange = `The block producer name of this node will be set to ${actualProducer}`;
    }
    return (
        <>
            {nameChange && <h3>{nameChange}</h3>}
            <h2>The following packages will be installed:</h2>
            {packages.map((name) => (
                <p>{name}</p>
            ))}
            <form
                onSubmit={() => {
                    runBoot(
                        packages,
                        actualProducer,
                        config,
                        refetchConfig,
                        setBootState
                    );
                    setCurrentPage("go");
                }}
            >
                <Button
                    className="mt-4"
                    onClick={() => setCurrentPage("producer")}
                >
                    Back
                </Button>
                <Button className="mt-4" isSubmit>
                    Install
                </Button>
            </form>
        </>
    );
};

export const ProgressPage = ({ state }: ProgressPageProps) => {
    if (state === undefined) {
        return <>Preparing to install</>;
    } else if (typeof state === "string") {
        return <>{state}</>;
    } else if (state[0] == "fetch") {
        return (
            <>
                Fetching packages {state[1]}/{state[2]}
            </>
        );
    } else if (state[0] == "push") {
        return (
            <>
                Pushing transactions {state[1]}/{state[2]}
            </>
        );
    } else {
        console.error(state);
        return <p>Unexpected boot state</p>;
    }
};

function useGetJson<R>(url: string): [R | undefined, string | undefined] {
    const [error, setError] = useState<string>();
    const [value, setValue] = useState<R>();
    useEffect(() => {
        if (value === undefined && error === undefined) {
            setError(`Waiting for ${url}`);
            (async () => {
                try {
                    let result = await getJson(url);
                    setValue(result);
                    setError(undefined);
                } catch (e) {
                    setError(`Failed to load ${url}`);
                }
            })();
        }
    }, []);
    return [value, error];
}

function dfs(
    index: PackageMap,
    names: string[],
    found: { [key: string]: boolean },
    result: string[]
) {
    for (let name of names) {
        let complete = found[name];
        if (complete === false) {
            throw new Error(`package ${name} depends on itself`);
        } else if (complete === undefined) {
            found[name] = false;
            let meta = index[name];
            if (!meta) {
                throw new Error(`package ${name} not found`);
            }
            dfs(index, meta.depends, found, result);
            result.push(name);
            found[name] = true;
        }
    }
}

function makePackageMap(index: PackageIndex): PackageMap {
    let result: PackageMap = {};
    for (let meta of index) {
        result[meta.name] = meta;
    }
    return result;
}

function resolvePackages(index: PackageMap, names: string[]): string[] {
    let found = {};
    let result: string[] = [];
    dfs(index, names, found, result);
    return result;
}

export const BootPage = ({ config, refetchConfig }: BootPageProps) => {
    const [bootState, setBootState] = useState<BootState>();

    let [serviceIndex, serviceIndexError] = useGetJson<PackageIndex>(
        "/packages/index.json"
    );
    serviceIndex = serviceIndex || [];

    const typeForm = useForm<InstallType>({
        defaultValues: { installType: "full" },
    });
    const servicesForm = useForm<ServicesType>();
    const producerForm = useForm<ProducerType>({
        defaultValues: { producer: config?.producer || "" },
    });

    const [currentPage, setCurrentPage] = useState<string>("type");

    let allServices = ["Default", "AuthSys", "AuthAnySys"];
    if (currentPage == "type") {
        return <TypeForm typeForm={typeForm} setCurrentPage={setCurrentPage} />;
    } else if (currentPage == "services") {
        return (
            <ServicesForm
                keys={serviceIndex.map((meta) => meta.name)}
                servicesForm={servicesForm}
                setCurrentPage={setCurrentPage}
            />
        );
    } else if (currentPage == "producer") {
        return (
            <ProducerForm
                producerForm={producerForm}
                typeForm={typeForm}
                setCurrentPage={setCurrentPage}
            />
        );
    } else if (currentPage == "install") {
        let namedPackages =
            typeForm.getValues("installType") == "full"
                ? ["Default"]
                : serviceIndex
                      .map((meta) => meta.name)
                      .filter((name) => servicesForm.getValues(name));
        return (
            <InstallForm
                packages={resolvePackages(
                    makePackageMap(serviceIndex),
                    namedPackages
                )}
                config={config}
                refetchConfig={refetchConfig}
                producerForm={producerForm}
                setCurrentPage={setCurrentPage}
                setBootState={setBootState}
            />
        );
    } else if (currentPage == "go") {
        return <ProgressPage state={bootState} />;
    }
};
