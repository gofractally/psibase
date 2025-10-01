import { Trash2 } from "lucide-react";
import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { useAppForm } from "@/components/forms/app-form";
import { FieldErrors } from "@/components/forms/field-errors";

import { useCandidates } from "@/hooks/use-candidates";
import { usePluginMutation } from "@/hooks/use-plugin-mutation";
import { isAccountAvailable } from "@/lib/isAccountAvailable";
import { Params, SetProducerParams } from "@/lib/producers";
import { CONFIG, PRODUCERS } from "@/lib/services";

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

const RegisterCandidateParams = z.object({
    endpoint: z.string().min(1, "Endpoint is required"),
    pemKey: z.string().min(1, "PEM key is required"),
});

type RegisterCandidateParams = z.infer<typeof RegisterCandidateParams>;

const useConfigPlugin = (
    method: string,
    meta: { loading: string; success: string; error: string },
) =>
    usePluginMutation(
        {
            intf: "producers",
            service: CONFIG,
            method,
        },
        {
            error: meta.error,
            loading: meta.loading,
            success: meta.success,
            isStagable: true,
        },
    );

const useProducersPlugin = (
    method: string,
    meta: {
        loading: string;
        success: string;
        error: string;
        isStagable?: boolean;
    },
) =>
    usePluginMutation(
        {
            intf: "api",
            service: PRODUCERS,
            method,
        },
        {
            error: meta.error,
            loading: meta.loading,
            success: meta.success,
            isStagable: meta.isStagable ?? true,
        },
    );

export const BlockProduction = () => {
    const { data: candidates, refetch: refetchCandidates } = useCandidates();

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

    const form = useAppForm({
        defaultValues: {
            prods: [""],
            mode: "existing",
        } as SetProducerParams,
        validators: {
            onChange: Params,
        },
        onSubmit: async ({ value: { mode, prods } }) => {
            if (mode == "existing") {
                setCurrent([prods]);
            } else if (mode == "bft") {
                setBft([prods]);
            } else if (mode == "cft") {
                setCft([prods]);
            } else {
                throw new Error("Unrecognised mode");
            }
        },
    });

    const registerForm = useAppForm({
        defaultValues: {
            endpoint: "",
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
        },
    });

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
                    form.handleSubmit();
                }}
                className="space-y-4"
            >
                <form.Field name="mode">
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
                </form.Field>

                {/* Producers List */}
                <form.Field name="prods" mode="array">
                    {(field) =>
                        field.state.value.map((_, index) => (
                            <div
                                key={index}
                                className="flex flex-col gap-2 rounded-md border p-3"
                            >
                                <div>
                                    <Label>#{index + 1}</Label>
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label htmlFor={`prods.${index}.name`}>
                                        Producer Name
                                    </Label>
                                    <Button
                                        variant="destructive"
                                        size="icon"
                                        className="flex items-center justify-center p-2"
                                        type="button"
                                        disabled={field.state.value.length == 1}
                                        onClick={() => field.removeValue(index)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                                <form.Field
                                    key={index}
                                    name={`prods[${index}]`}
                                    validators={{
                                        onChangeAsync: async ({ value }) => {
                                            const status =
                                                await isAccountAvailable(value);
                                            if (status == "Available") {
                                                return "Account does not exist";
                                            } else if (status == "Invalid") {
                                                return "Account is invalid";
                                            }
                                        },
                                    }}
                                    asyncDebounceMs={600}
                                >
                                    {(subfield) => (
                                        <Input
                                            id={`prods.${index}`}
                                            placeholder="Producer name"
                                            value={subfield.state.value}
                                            onChange={(e) =>
                                                subfield.handleChange(
                                                    e.target.value,
                                                )
                                            }
                                        />
                                    )}
                                </form.Field>
                                <form.Subscribe
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
                </form.Field>

                <div className="flex justify-between">
                    <Button
                        variant="outline"
                        type="button"
                        onClick={() => {
                            form.setFieldValue("prods", (prods) => [
                                ...prods,
                                "",
                            ]);
                        }}
                    >
                        Add Producer
                    </Button>
                    <form.AppForm>
                        <form.SubmitButton labels={["Save", "Saving"]} />
                    </form.AppForm>
                </div>
            </form>

            <div>
                <h2 className="text-lg font-medium">
                    Register Producer Candidate
                </h2>
                <p className="text-muted-foreground text-sm">
                    Register yourself as a new producer candidate.
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

                <div className="flex justify-end">
                    <registerForm.AppForm>
                        <registerForm.SubmitButton
                            labels={["Register", "Registering"]}
                        />
                    </registerForm.AppForm>
                </div>
            </form>

            <div>
                <h2 className="text-lg font-medium">Registered Candidates</h2>
                <p className="text-muted-foreground text-sm">
                    All registered producer candidates.
                </p>
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
                        {candidates?.map((candidate, index) => (
                            <TableRow key={index}>
                                <TableCell className="font-mono">
                                    {candidate.account}
                                </TableCell>
                                <TableCell className="font-mono">
                                    {candidate.endpoint}
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
