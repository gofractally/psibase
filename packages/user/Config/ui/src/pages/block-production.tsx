import { PlusIcon, Settings, Trash, TrashIcon, } from "lucide-react";
import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { useAppForm } from "@/components/forms/app-form";
import { FieldErrors } from "@/components/forms/field-errors";

import { useCandidates } from "@/hooks/use-candidates";
import { Params, SetProducerParams } from "@/lib/producers";

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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";
import { Textarea } from "@shared/shadcn/ui/textarea";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useState } from "react";

import {
    Dialog,
    DialogContent,
} from "@shared/shadcn/ui/dialog";
import { useProducersPlugin } from "@/hooks/use-producers-plugin";
import { useConfigPlugin } from "@/hooks/use-config-plugin";
import { useStore } from "@tanstack/react-form";

const RegisterCandidateParams = z.object({
    endpoint: z.string().url().min(1, "Endpoint is required"),
    pemKey: z.string().min(1, "PEM key is required"),
});

type RegisterCandidateParams = z.infer<typeof RegisterCandidateParams>;


export const BlockProduction = () => {
    const { data: candidates, refetch: refetchCandidates } = useCandidates();

    const { data: currentUser } = useCurrentUser();

    const authenticatedCandidate = candidates?.find(candidate => candidate.account === currentUser);

    const [showModal, setShowModal] = useState(false);

    const { mutateAsync: unregisterCandidate, isPending: isUnregistering } = useProducersPlugin('unregisterCandidate', {
        error: "Failed unregistering candidate",
        loading: "Unregistering candidate",
        success: "Unregistered candidate ",
        isStagable: false
    });

    const { mutateAsync: registerCandidate } = useProducersPlugin(
        "registerCandidate",
        {
            loading: "Registering candidate",
            success: "Registered candidate",
            error: "Failed to register candidate",
            isStagable: false,
        },
    );
    const { mutateAsync: setCurrent } = useConfigPlugin("setProducers", {
        loading: "Setting producers",
        success: "Set producers",
        error: "Failed to set producers",
    });
    const { mutateAsync: setBft } = useConfigPlugin("setBftConsensus", {
        loading: "Setting producers (BFT)",
        success: "Set producers (BFT)",
        error: "Failed to set producers",
    });
    const { mutateAsync: setCft } = useConfigPlugin("setCftConsensus", {
        loading: "Setting producers (CFT)",
        success: "Set producers (CFT)",
        error: "Failed to set producers",
    });

    const producersForm = useAppForm({
        defaultValues: {
            prods: [],
            mode: "existing",
        } as SetProducerParams,
        validators: {
            onChange: Params,
        },
        onSubmit: async ({ value: { mode, prods } }) => {
            if (mode == "existing") {
                await setCurrent([prods]);
            } else if (mode == "bft") {
                await setBft([prods]);
            } else if (mode == "cft") {
                await setCft([prods]);
            } else {
                throw new Error("Unrecognised mode");
            }
        },
    });

    const producers = useStore(producersForm.store, store => store.values.prods);

    const registerForm = useAppForm({
        defaultValues: {
            endpoint: authenticatedCandidate?.endpoint || '',
            pemKey: "",
        } as RegisterCandidateParams,
        validators: {
            onChange: RegisterCandidateParams,
        },
        onSubmit: async ({ value }) => {
            const { endpoint, pemKey } = value;
            const claim = { tag: "pubkey-pem", val: pemKey };
            await registerCandidate([endpoint, claim]);
            refetchCandidates();
            setShowModal(false);
        },
    });

    const unregister = async () => {
        await unregisterCandidate([])
        setShowModal(false)
    }

    return (
        <div className="mx-auto w-full max-w-screen-lg space-y-6">
            <div>
                <h2 className="text-lg font-medium">Producers</h2>
                <p className="text-muted-foreground text-sm">
                    Manage producers by adding their name and PEM key. Each
                    producer requires both fields.
                </p>
            </div>

            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    producersForm.handleSubmit();
                }}
                className="space-y-4"
            >
                <producersForm.Field name="mode">
                    {(field) => (
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="mode">Consensus Mode</Label>
                            <Select
                                onValueChange={(value) => {
                                    field.setValue(
                                        value as "cft" | "bft" | "existing",
                                    );
                                }}
                                value={field.state.value}
                            >
                                <SelectTrigger id="mode">
                                    <SelectValue placeholder="Select mode" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="existing">
                                        Existing
                                    </SelectItem>
                                    <SelectItem value="cft">
                                        Crash Fault Tolerance (CFT)
                                    </SelectItem>
                                    <SelectItem value="bft">
                                        Byzantine Fault Tolerance (BFT)
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-muted-foreground text-sm">
                                <a
                                    className="hover:text-primary underline underline-offset-2"
                                    href={siblingUrl(
                                        undefined,
                                        "docs",
                                        "/specifications/blockchain/peer-consensus",
                                    )}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    BFT vs CFT - What's the difference?
                                </a>
                            </p>
                        </div>
                    )}
                </producersForm.Field>

                {/* Producers List */}
                <producersForm.Field name="prods" mode="array">
                    {(field) =>
                        field.state.value.map((value, index) => (
                            <div
                                key={index}
                                className="flex flex-col gap-2 rounded-md border p-3"
                            >
                                <div>
                                    <Label>#{index + 1}</Label>
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label htmlFor={`prods.${index}.name`}>
                                        Producer {field.state.value[index]}
                                    </Label>
                                    <Button variant="destructive" size={"icon"} onClick={() => {
                                        producersForm.setFieldValue('prods', prods => prods.filter(prod => prod !== value))
                                    }}>
                                        <Trash />
                                    </Button>
                                </div>

                                <producersForm.Subscribe
                                    selector={(f) =>
                                        f.fieldMeta[`prods[${index}]`]
                                    }
                                    children={(fieldMeta) => (
                                        <FieldErrors meta={fieldMeta} />
                                    )}
                                />
                            </div>
                        ))
                    }
                </producersForm.Field>

                <div className="flex justify-end">
                    <producersForm.AppForm>
                        <producersForm.SubmitButton labels={["Save", "Saving"]} />
                    </producersForm.AppForm>
                </div>
            </form>

            <Dialog onOpenChange={e => setShowModal(e)} open={showModal}>
                <DialogContent className="sm:max-w-2xl">
                    <div className="gap-2">
                        <h2 className="text-lg font-medium">
                            Producer Candidate Registration
                        </h2>
                        <p className="text-muted-foreground text-sm">
                            {authenticatedCandidate ? 'Update registration' : 'Register yourself as a new producer candidate'}.
                        </p>

                    </div>

                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            registerForm.handleSubmit();
                        }}
                        className="space-y-4"
                    >
                        <registerForm.Field name="endpoint">
                            {(field) => (
                                <div className="flex flex-col gap-2">
                                    <Label htmlFor="endpoint">Endpoint</Label>
                                    <Input
                                        id="endpoint"
                                        placeholder="https://example.com"
                                        value={field.state.value}
                                        onChange={(e) =>
                                            field.handleChange(e.target.value)
                                        }
                                    />
                                    <registerForm.Subscribe
                                        selector={(f) => f.fieldMeta.endpoint}
                                        children={(fieldMeta) => (
                                            <FieldErrors meta={fieldMeta} />
                                        )}
                                    />
                                </div>
                            )}
                        </registerForm.Field>

                        <registerForm.Field name="pemKey">
                            {(field) => (
                                <div className="flex flex-col gap-2">
                                    <Label htmlFor="pemKey">Public Key (PEM)</Label>
                                    <Textarea
                                        id="pemKey"
                                        placeholder="-----BEGIN PUBLIC KEY-----&#10;...&#10;-----END PUBLIC KEY-----"
                                        value={field.state.value}
                                        onChange={(e) =>
                                            field.handleChange(e.target.value)
                                        }
                                        rows={6}
                                    />
                                    <registerForm.Subscribe
                                        selector={(f) => f.fieldMeta.pemKey}
                                        children={(fieldMeta) => (
                                            <FieldErrors meta={fieldMeta} />
                                        )}
                                    />
                                </div>
                            )}
                        </registerForm.Field>

                        <div className="flex justify-between">
                            <div>
                                {authenticatedCandidate && <Button variant={"destructive"} disabled={isUnregistering} onClick={(e) => {
                                    e.preventDefault()
                                    unregister()
                                }}>
                                    <Trash /> Unregister</Button>}
                            </div>
                            <registerForm.AppForm>
                                <registerForm.SubmitButton
                                    labels={authenticatedCandidate ? ['Update', 'Updating'] : ["Register", "Registering"]}
                                />
                            </registerForm.AppForm>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>


            <div className="flex justify-between">
                <div>
                    <h2 className="text-lg font-medium">Registered Candidates</h2>
                    <p className="text-muted-foreground text-sm">
                        All registered producer candidates.
                    </p>
                </div>
                <div className="flex items-center">
                    <Button size="sm" onClick={() => { setShowModal(true) }}>
                        {authenticatedCandidate ? <div className="flex gap-1 items-center"><Settings />Update</div> : <div className="flex gap-1 items-center"><PlusIcon />Register</div>}
                    </Button>
                </div>
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Account Name</TableHead>
                            <TableHead>Endpoint</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {candidates?.map((candidate) => (
                            <TableRow key={candidate.account}>
                                <TableCell className="font-mono">
                                    {candidate.account}
                                </TableCell>
                                <TableCell className="font-mono">
                                    {candidate.endpoint}
                                </TableCell>
                                <TableCell>
                                    {producers.includes(candidate.account) ? <Button variant="outline" size={"icon"} onClick={() => {
                                        producersForm.setFieldValue('prods', prods => prods.filter(prod => prod !== candidate.account))
                                    }}>
                                        <TrashIcon />
                                    </Button> : <Button variant="outline" size={"icon"} onClick={() => {
                                        producersForm.setFieldValue('prods', prods => [...prods, candidate.account])
                                    }}>
                                        <PlusIcon />
                                    </Button>}
                                </TableCell>
                            </TableRow>
                        ))}
                        {(!candidates || candidates.length === 0) && (
                            <TableRow>
                                <TableCell
                                    colSpan={2}
                                    className="text-muted-foreground text-center"
                                >
                                    No candidates registered
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
};
