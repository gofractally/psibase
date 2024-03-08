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

interface PackageRef {
    name: string;
    version: string;
}

interface PackageMeta {
    name: string;
    version: string;
    description: string;
    depends: PackageRef[];
    accounts: string[];
}

interface PackageInfo extends PackageMeta {
    file: string;
    sha256: string;
}

type PackageIndex = PackageInfo[];

interface PackageOp {
    Install?: PackageInfo;
    Replace?: [PackageMeta, PackageInfo];
    Remove?: PackageMeta;
}

interface TypeFormProps {
    setPackages: (names: string[]) => void;
    typeForm: UseFormReturn<InstallType>;
    setCurrentPage: (page: string) => void;
}

interface ServicesFormProps {
    setPackages: (names: string[]) => void;
    serviceIndex: PackageInfo[];
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

interface InnerTrace {
    ActionTrace?: ActionTrace;
    ConsoleTrace?: any;
    EventTrace?: any;
}

interface Action {
    sender: string;
    service: string;
    method: string;
    rawData: string;
}

interface ActionTrace {
    action: Action;
    rawRetval: string;
    innerTraces: { inner: InnerTrace }[];
    totalTime: number;
    error?: string;
}

interface TransactionTrace {
    actionTraces: ActionTrace[];
    error?: string;
}

type BootState =
    | undefined
    | [string, number, number]
    | string
    | TransactionTrace;

interface InstallFormProps {
    packages: PackageInfo[];
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

export const TypeForm = ({
    setPackages,
    typeForm,
    setCurrentPage,
}: TypeFormProps) => {
    return (
        <form
            onSubmit={typeForm.handleSubmit((state) => {
                if (state.installType == "full") {
                    setPackages(["Default"]);
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

type ParsedVersion = undefined | [number, number, number];

function splitVersion(version: string): ParsedVersion {
    let result = version.match(/^(\d+).(\d+).(\d+)(?:\+.*)?$/);
    if (result) {
        return [+result[0], +result[1], +result[2]];
    }
}

function versionLess(lhs: ParsedVersion, rhs: ParsedVersion) {
    if (lhs && rhs) {
        for (let i = 0; i < 3; ++i) {
            if (lhs[i] != rhs[i]) {
                return lhs[i] < rhs[i];
            }
        }
        return false;
    }
    if (rhs) {
        return true;
    }
    return false;
}

function installedOnly(ops: PackageOp[]): PackageInfo[] {
    return ops.map((op) => {
        if (op.Install) {
            return op.Install;
        } else {
            throw Error(`Expected install: ${op}`);
        }
    });
}

export const ServicesForm = ({
    setPackages,
    serviceIndex,
    servicesForm,
    setCurrentPage,
}: ServicesFormProps) => {
    let byname = new Map();
    for (let info of serviceIndex) {
        let version = splitVersion(info.version);
        if (version) {
            let existing = byname.get(info.name);
            if (
                !existing ||
                versionLess(splitVersion(existing.version), version)
            ) {
                byname.set(info.name, info);
            }
        }
    }
    return (
        <form
            onSubmit={servicesForm.handleSubmit((state) => {
                setPackages(
                    serviceIndex
                        .map((meta) => meta.name)
                        .filter((name) => servicesForm.getValues(name))
                );
                setCurrentPage("producer");
            })}
        >
            {[...byname.values()].map((info) => (
                <Form.Checkbox
                    label={`${info.name}-${info.version}`}
                    {...servicesForm.register(info.name)}
                />
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

function getActionStack(trace: ActionTrace): Action[] | undefined {
    if (trace.error) {
        for (let atrace of trace.innerTraces) {
            if (atrace.inner.ActionTrace) {
                let result = getActionStack(atrace.inner.ActionTrace);
                if (result) {
                    return [trace.action, ...result];
                }
            }
        }
        return [trace.action];
    }
}

const getStack = (trace: TransactionTrace) => {
    for (let atrace of trace.actionTraces) {
        let stack = getActionStack(atrace);
        if (stack) {
            return (
                <p>
                    {stack.map((act) => (
                        <>
                            {" "}
                            {`${act.sender} => ${act.service}::${act.method}`}{" "}
                            <br />
                        </>
                    ))}
                    {trace.error}
                </p>
            );
        }
    }
};

async function runBoot(
    packageInfo: PackageInfo[],
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
        for (let info of packageInfo) {
            setBootState(["fetch", i, packageInfo.length]);
            packages.push(await getArrayBuffer(`/packages/${info.file}`));
            i++;
        }
        // Something is wrong with the Vite proxy configuration that causes boot to intermittently (but often) fail
        // in a dev environment.
        let [boot_transactions, transactions] =
            wasm.js_create_boot_transactions(producer, packages);
        setBootState(["push", 0, transactions.length + 1]);
        let trace = await postArrayBufferGetJson(
            "/native/push_boot",
            boot_transactions.buffer
        );
        if (trace.error) {
            setBootState(trace);
            console.error(trace.error);
            return;
        }
        i = 1;
        for (const t of transactions) {
            console.log(`Pushing transaction number: ${i}`);
            setBootState(["push", i, transactions.length + 1]);
            let trace = await postArrayBufferGetJson(
                "/native/push_transaction",
                t.buffer
            );
            if (trace.error) {
                setBootState(trace);
                console.error(trace.error);
                return;
            }
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
            {packages.map((info) => (
                <p>
                    {info.name}-{info.version}
                </p>
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
    } else if ("actionTraces" in state) {
        return <>Boot failed: {getStack(state)}</>;
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

    let [packagesToInstall, setPackagesToInstall] = useState<PackageInfo[]>();

    let resolvePackages = (names: string[]) => {
        console.log(names);
        setPackagesToInstall(
            installedOnly(wasm.js_resolve_packages(serviceIndex, names, []))
        );
    };

    let allServices = ["Default", "AuthSys", "AuthAnySys"];
    if (currentPage == "type") {
        return (
            <TypeForm
                setPackages={resolvePackages}
                typeForm={typeForm}
                setCurrentPage={setCurrentPage}
            />
        );
    } else if (currentPage == "services") {
        return (
            <ServicesForm
                setPackages={resolvePackages}
                serviceIndex={serviceIndex}
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
                packages={packagesToInstall || []}
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
