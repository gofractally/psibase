import { useState, useEffect } from "react";
import { Controller, useForm, UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { PsinodeConfig } from "../configuration/interfaces";
import { putJson } from "../helpers";
import {
    getJson,
    getArrayBuffer,
    postArrayBuffer,
    postArrayBufferGetJson,
} from "@psibase/common-lib";
import * as wasm from "wasm-psibase";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";

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
            <Controller
                name="installType"
                control={typeForm.control}
                render={({ field }) => (
                    <RadioGroup
                        defaultValue={field.value || "full"}
                        onValueChange={field.onChange}
                    >
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="full" id="option-one" />
                            <Label htmlFor="option-one">
                                Install all services
                            </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="custom" id="option-two" />
                            <Label htmlFor="option-two">
                                Choose services to install
                            </Label>
                        </div>
                    </RadioGroup>
                )}
            />

            <Button className="mt-4" type="submit">
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
                <Controller
                    name={info.name}
                    control={servicesForm.control}
                    render={({ field }) => (
                        <div className="flex items-center space-x-2 py-2">
                            <Checkbox
                                id={`info-${info.name}`}
                                checked={field.value}
                                onCheckedChange={field.onChange}
                            />
                            <Label
                                htmlFor={`info-${info.name}`}
                            >{`${info.name}-${info.version}`}</Label>
                        </div>
                    )}
                />
            ))}
            <Button
                className="mt-4"
                variant="secondary"
                onClick={() => {
                    setCurrentPage("type");
                }}
            >
                Back
            </Button>
            <Button className="mt-4" type="submit">
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
                <div className="grid w-full max-w-sm items-center gap-1.5">
                    <Label htmlFor="bp-name">Block producer name</Label>
                    <Input
                        id="bp-name"
                        {...producerForm.register("producer", {
                            required: true,
                            pattern: /[-a-z0-9]+/,
                        })}
                    />
                </div>

                <Button
                    className="mt-4 "
                    variant="secondary"
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
                    type="submit"
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
        nameChange = actualProducer;
    }
    return (
        <>
            {nameChange && (
                <h4 className="my-3 scroll-m-20 text-xl font-semibold tracking-tight">
                    <span className="text-muted-foreground">
                        The block producer name of this node will be set to{" "}
                    </span>
                    {nameChange}
                </h4>
            )}
            <ScrollArea className=" h-[800px]">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableCell
                                colSpan={4}
                                className="mx-auto bg-primary-foreground text-center"
                            >
                                The following packages will be installed
                            </TableCell>
                        </TableRow>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>File</TableHead>
                            <TableHead className="text-right">
                                Version
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {packages.map((info) => (
                            <TableRow key={info.sha256}>
                                <TableCell>{info.name}</TableCell>
                                <TableCell>{info.description}</TableCell>
                                <TableCell>{info.file}</TableCell>
                                <TableCell className="text-right">
                                    {info.version}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </ScrollArea>
            <form
                className="flex w-full justify-between"
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
                    variant="secondary"
                    className="mt-4"
                    onClick={() => setCurrentPage("producer")}
                >
                    Back
                </Button>
                <Button className="mt-4" type="submit">
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
    } else if (state[0] == "fetch" || state[0] == "push") {
        const percent = Math.floor((state[1] / state[2]) * 100);
        return (
            <div>
                <Progress value={percent} />
                <div>
                    {state[0] == "fetch"
                        ? "Fetching packages"
                        : "Pushing transactions"}{" "}
                </div>
            </div>
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
