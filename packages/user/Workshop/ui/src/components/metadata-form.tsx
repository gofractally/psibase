import type React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { Trash, Upload } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ZodError, z } from "zod";

import { fileToBase64 } from "@/lib/fileToBase64";

import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormRootError,
} from "@shared/shadcn/ui/form";
import { Input } from "@shared/shadcn/ui/input";
import { Separator } from "@shared/shadcn/ui/separator";
import { toast } from "@shared/shadcn/ui/sonner";
import { Textarea } from "@shared/shadcn/ui/textarea";

const formSchema = z.object({
    name: z.string(),
    shortDesc: z.string(),
    longDesc: z.string(),
    icon: z.string(),
    iconMimeType: z.string(), // MIME type of the icon
    tags: z.string().array(), // List of tags
});

export type Schema = z.infer<typeof formSchema>;

interface Props {
    existingValues?: Schema;
    onSubmit: (data: Schema) => Promise<Schema>;
}

const blankDefaultValues = formSchema.parse({
    name: "",
    shortDesc: "",
    longDesc: "",
    icon: "",
    iconMimeType: "",
    tags: [],
});

export const MetaDataForm = ({ existingValues, onSubmit }: Props) => {
    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: existingValues || blankDefaultValues,
    });

    const [iconPreview, setIconPreview] = useState<string | null>(null);

    const submit = async (data: Schema) => {
        try {
            form.clearErrors();
            toast("Saving...");
            await onSubmit({
                ...data,
            });
            form.reset(data);
            toast("Success", { description: `Saved changes.` });
        } catch (error) {
            if (error instanceof ZodError) {
                error.issues.forEach((field) => {
                    form.setError(field.path[0] as keyof Schema, {
                        message: field.message,
                    });
                });
                toast("Invalid submission", {
                    description: "One or more fields are invalid.",
                });
            } else if (error instanceof Error) {
                form.setError("root", {
                    message:
                        error instanceof Error
                            ? error.message
                            : "Unrecognised error, see log.",
                });
                toast("Request failed", { description: error.message });
            }
        }
    };

    const isIcon =
        iconPreview ||
        (existingValues && existingValues.icon && existingValues.iconMimeType);
    const currentSrc = `data:${existingValues?.iconMimeType};base64,${existingValues?.icon}`;

    const handleIconChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const mimeType = file.type;
            const base64Icon = await fileToBase64(file);

            const iconSrc = `data:${mimeType};base64,${base64Icon}`;
            form.setValue("icon", base64Icon, { shouldDirty: true });
            form.setValue("iconMimeType", mimeType, { shouldDirty: true });
            setIconPreview(iconSrc);

            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onloadend = () => {
                setIconPreview(reader.result as string);
            };
        }
    };

    return (
        <Card className="mx-auto w-full">
            <CardHeader>
                <CardTitle>App Metadata</CardTitle>
                <CardDescription>
                    Configure your app's information and settings
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Form {...form}>
                    <form
                        onSubmit={form.handleSubmit(submit)}
                        className="space-y-6"
                    >
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>App Name</FormLabel>
                                    <FormControl>
                                        <Input
                                            {...field}
                                            placeholder="Enter your app name"
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <div className="grid gap-4 md:grid-cols-2">
                            <FormField
                                control={form.control}
                                name="shortDesc"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Tagline</FormLabel>
                                        <FormControl>
                                            <Input
                                                {...field}
                                                placeholder="Brief description of the app"
                                            />
                                        </FormControl>
                                        <FormDescription>
                                            Brief description of the app (max
                                            100 characters)
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="icon"
                                render={() => (
                                    <FormItem>
                                        <FormLabel>Icon</FormLabel>
                                        <FormControl>
                                            <div className="flex items-center space-x-4">
                                                <div className="flex-1">
                                                    <label
                                                        htmlFor="icon-upload"
                                                        className="cursor-pointer"
                                                    >
                                                        <div className="flex h-10 w-full items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
                                                            <Upload className="mr-2 h-5 w-5" />
                                                            Upload Icon
                                                        </div>
                                                    </label>
                                                    <Input
                                                        id="icon-upload"
                                                        type="file"
                                                        accept="image/*"
                                                        onChange={
                                                            handleIconChange
                                                        }
                                                        className="hidden"
                                                    />
                                                </div>
                                                {isIcon && (
                                                    <img
                                                        src={
                                                            iconPreview ||
                                                            currentSrc
                                                        }
                                                        alt="Icon preview"
                                                        className="h-10 w-10 rounded-lg object-cover"
                                                    />
                                                )}
                                                {iconPreview && (
                                                    <Button
                                                        type="button"
                                                        onClick={() => {
                                                            setIconPreview(
                                                                null,
                                                            );
                                                            form.resetField(
                                                                "icon",
                                                            );
                                                            form.resetField(
                                                                "iconMimeType",
                                                            );
                                                        }}
                                                        variant="outline"
                                                        size="icon"
                                                    >
                                                        <Trash className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        </FormControl>
                                        <FormDescription>
                                            Upload an icon for your app
                                            (recommended size: 512x512px)
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                        <FormField
                            control={form.control}
                            name="longDesc"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Long Description</FormLabel>
                                    <FormControl>
                                        <Textarea
                                            className="min-h-[100px] resize-none"
                                            {...field}
                                            placeholder="Provide a detailed description of your app"
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <Separator />
                        <div className="flex justify-end">
                            <Button
                                type="submit"
                                disabled={
                                    form.formState.isSubmitting ||
                                    !form.formState.isDirty
                                }
                            >
                                Save Changes
                            </Button>
                        </div>
                        <FormRootError />
                    </form>
                </Form>
            </CardContent>
        </Card>
    );
};
