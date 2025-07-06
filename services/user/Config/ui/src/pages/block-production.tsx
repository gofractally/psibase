import { Trash2 } from "lucide-react";

import { siblingUrl } from "@psibase/common-lib";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { useAppForm } from "@/components/forms/app-form";

export const BlockProduction = () => {
    const form = useAppForm({
        defaultValues: {
            prods: [{ name: "", authClaim: { tag: "pubkey-pem", val: "" } }],
            mode: "existing",
        },
        onSubmit: (value) => {
            console.log(value, "microwave");
        },
    });

    const errors = form.state.errorMap;

    console.log({ errors });
    return (
        <div className="mx-auto max-w-screen-lg space-y-6">
            <div>
                <h2 className="text-lg font-medium">Producers</h2>
                <p className="text-muted-foreground text-sm">
                    Manage producers by adding their name and PEM key. Each
                    producer requires both fields.
                </p>
            </div>

            {form.state.errors && (
                <p className="text-destructive text-sm">
                    {form.state.errors.map((error) => JSON.stringify(error))}
                </p>
            )}

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
                        field.state.value.map((_, index) => {
                            return (
                                <div
                                    key={index}
                                    className="flex flex-col gap-2 rounded-md border p-3"
                                >
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor={`prods.${index}.name`}>
                                            Producer Name
                                        </Label>
                                        <Button
                                            variant="destructive"
                                            size="icon"
                                            className="flex items-center justify-center p-2"
                                            type="button"
                                            onClick={() =>
                                                field.removeValue(index)
                                            }
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <form.Field
                                        key={index}
                                        name={`prods[${index}].name`}
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

                                    <form.Field
                                        key={index}
                                        name={`prods[${index}].authClaim`}
                                    >
                                        {(subfield) => (
                                            <>
                                                <Label
                                                    htmlFor={`prods.[${index}].authClaim.val`}
                                                >
                                                    PEM Key
                                                </Label>
                                                <Textarea
                                                    id={`prods.[${index}].authClaim.val`}
                                                    placeholder="Paste PEM key here (e.g., -----BEGIN PUBLIC KEY-----...)"
                                                    rows={5}
                                                    onChange={(e) =>
                                                        subfield.handleChange({
                                                            tag: "pubkey-pem",
                                                            val: e.target.value,
                                                        })
                                                    }
                                                    value={
                                                        subfield.state.value.val
                                                    }
                                                />
                                            </>
                                        )}
                                    </form.Field>
                                </div>
                            );
                        })
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
