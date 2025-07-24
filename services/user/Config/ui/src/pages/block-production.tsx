import { Trash2 } from "lucide-react";

import { siblingUrl } from "@psibase/common-lib";

import { useAppForm } from "@/components/forms/app-form";
import { FieldErrors } from "@/components/forms/field-errors";

import { usePluginMutation } from "@/hooks/use-plugin-mutation";
import { isAccountAvailable } from "@/lib/isAccountAvailable";
import { Params, PubKeyAuthClaim, SetProducerParams } from "@/lib/producers";
import { CONFIG } from "@/lib/services";

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
import { Textarea } from "@shared/shadcn/ui/textarea";

const useProducersPlugin = (method: string) =>
    usePluginMutation(
        {
            intf: "producers",
            service: CONFIG,
            method,
        },
        {
            error: "Failed setting producers",
            loading: "Setting producers",
            success: "Set producers",
            isStagable: true,
        },
    );

export const BlockProduction = () => {
    const { mutateAsync: setCurrent } = useProducersPlugin("setProducers");
    const { mutateAsync: setBft } = useProducersPlugin("setBftConsensus");
    const { mutateAsync: setCft } = useProducersPlugin("setCftConsensus");

    const form = useAppForm({
        defaultValues: {
            prods: [{ name: "", authClaim: { tag: "pubkey-pem", val: "" } }],
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
                                    name={`prods[${index}].name`}
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
                                            id={`prods.${index}.name`}
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
                                        f.fieldMeta[`prods[${index}].name`]
                                    }
                                    children={(fieldMeta) => (
                                        <FieldErrors meta={fieldMeta} />
                                    )}
                                />

                                <form.Field
                                    key={index}
                                    name={`prods[${index}].authClaim`}
                                    validators={{
                                        onChange: PubKeyAuthClaim,
                                    }}
                                >
                                    {(subfield) => (
                                        <>
                                            <Label>PEM Key</Label>
                                            <Textarea
                                                placeholder="Paste PEM key here (e.g., -----BEGIN PUBLIC KEY-----...)"
                                                rows={5}
                                                onChange={(e) =>
                                                    subfield.handleChange({
                                                        tag: "pubkey-pem",
                                                        val: e.target.value,
                                                    })
                                                }
                                                value={subfield.state.value.val}
                                            />
                                            <FieldErrors
                                                meta={subfield.state.meta}
                                            />
                                        </>
                                    )}
                                </form.Field>
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
                                {
                                    authClaim: { tag: "pubkey-pem", val: "" },
                                    name: "",
                                },
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
        </div>
    );
};
