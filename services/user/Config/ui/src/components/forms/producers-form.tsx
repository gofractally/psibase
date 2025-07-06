import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";
import { ZodError, z } from "zod";

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

import { Params } from "@/hooks/useSetProducers";

export type ProducersFormData = z.infer<typeof Params>;

export const ProducersForm = () => {
    const form = useForm<ProducersFormData>({
        resolver: zodResolver(Params),
        defaultValues: {
            prods: [{ name: "", authClaim: { tag: "pubkey-pem", val: "" } }],
            mode: "existing",
        },
    });

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "prods",
    });

    const handleAddProducer = () => {
        append({ name: "", authClaim: { tag: "pubkey-pem", val: "" } });
    };

    const submit = async (values: ProducersFormData) => {
        try {
            console.log(values, "are the values");
            form.reset(values);
        } catch (e) {
            console.error("Failed to submit Producers form:", e);
            if (e instanceof ZodError) {
                e.errors.forEach((error) => {
                    const path = error.path.join(".");
                    console.log(`Setting error at ${path}: ${error.message}`);
                    form.setError(path as keyof ProducersFormData, {
                        message: error.message,
                    });
                });
            } else {
                form.setError("root", {
                    message:
                        e instanceof Error
                            ? e.message
                            : "An unknown error occurred",
                });
            }
        }
    };

    console.log(form.formState.errors, "errors");

    const currentMode = form.getValues("mode");
    console.log({ currentMode });

    return (
        <div className="space-y-6 ">
            <div>
                <h2 className="text-lg font-medium">Producers</h2>
                <p className="text-muted-foreground text-sm">
                    Manage producers by adding their name and PEM key. Each
                    producer requires both fields.
                </p>
            </div>

            {form.formState.errors.root && (
                <p className="text-destructive text-sm">
                    {form.formState.errors.root.message}
                </p>
            )}

            <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
                {/* Mode Selection */}
                <div className="flex flex-col gap-2">
                    <Label htmlFor="mode">Consensus Mode</Label>
                    <Select
                        onValueChange={(value) => {
                            console.log({ value });
                            form.setValue(
                                "mode",
                                value as "cft" | "bft" | "existing",
                            );
                        }}
                        value={form.watch("mode")}
                    >
                        <SelectTrigger id="mode">
                            <SelectValue placeholder="Select mode" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="existing">Existing</SelectItem>
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

                    {form.formState.errors.mode && (
                        <p className="text-destructive text-sm">
                            {form.formState.errors.mode.message}
                        </p>
                    )}
                </div>

                {/* Producers List */}
                <div className="flex flex-col gap-4">
                    {fields.map((field, index) => (
                        <div
                            key={field.id}
                            className="flex flex-col gap-2 rounded-md border p-3"
                        >
                            <div className="flex items-center justify-between">
                                <Label htmlFor={`prods.${index}.name`}>
                                    Producer Name
                                </Label>
                                <Button
                                    variant="destructive"
                                    size="icon"
                                    disabled={fields.length === 1}
                                    className="flex items-center justify-center p-2"
                                    type="button"
                                    onClick={() => remove(index)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                            <Input
                                id={`prods.${index}.name`}
                                placeholder="Producer name"
                                {...form.register(`prods.${index}.name`)}
                            />
                            {form.formState.errors.prods?.[index]?.name && (
                                <p className="text-destructive text-sm">
                                    {
                                        form.formState.errors.prods[index]?.name
                                            ?.message
                                    }
                                </p>
                            )}

                            <Label htmlFor={`prods.${index}.authClaim.val`}>
                                PEM Key
                            </Label>
                            <Textarea
                                id={`prods.${index}.authClaim.val`}
                                placeholder="Paste PEM key here (e.g., -----BEGIN PUBLIC KEY-----...)"
                                rows={5}
                                {...form.register(
                                    `prods.${index}.authClaim.val`,
                                )}
                            />
                            {form.formState.errors.prods?.[index]?.authClaim
                                ?.val && (
                                <p className="text-destructive text-sm">
                                    {
                                        form.formState.errors.prods[index]
                                            ?.authClaim?.val?.message
                                    }
                                </p>
                            )}
                        </div>
                    ))}
                </div>

                <div className="flex justify-between">
                    <Button
                        variant="outline"
                        type="button"
                        onClick={handleAddProducer}
                    >
                        Add Producer
                    </Button>
                    <Button
                        type="submit"
                        disabled={form.formState.isSubmitting}
                    >
                        Save
                    </Button>
                </div>
            </form>
        </div>
    );
};
