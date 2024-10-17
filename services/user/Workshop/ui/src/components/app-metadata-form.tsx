import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import slugify from "slugify";
import { Button } from "@shadcn/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@shadcn/form";

import { Input } from "@shadcn/input";
import { Textarea } from "@shadcn/textarea";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useUser } from "@hooks";

import { RegisteredApp } from "@types";
import { RadioGroup, RadioGroupItem } from "@shadcn/radio-group";
import { Metadata, useMetadata } from "@hooks/use-metadata";
import { TagSelect } from "./tag-select";
import { fileToBase64, isValidUrl } from "@lib/utils";
import { LoadingSpinner } from "./spinner";

const slugifyOptions = { lower: true, strict: true };

const AppMetadataSchema = z.object({
    icon: z.instanceof(File).optional(),
    name: z.string().min(1, "Name is required"),
    shortDescription: z
        .string()
        .max(100, "Short description must be 100 characters or less")
        .optional(),
    longDescription: z.string().optional(),
    tosSubpage: z
        .string()
        .refine(
            (value) =>
                value.startsWith("/") &&
                slugify(value, slugifyOptions) === value.slice(1),
            "Must start with '/' and be a valid slug",
        )
        .optional(),
    privacyPolicySubpage: z
        .string()
        .refine(
            (value) =>
                value.startsWith("/") &&
                slugify(value, slugifyOptions) === value.slice(1),
            "Must start with '/' and be a valid slug",
        )
        .optional(),
    appHomepageSubpage: z
        .string()
        .refine(
            (value) =>
                value.startsWith("/") &&
                slugify(value, slugifyOptions) === value.slice(1),
            "Must start with '/' and be a valid slug",
        )
        .optional(),
    status: z.enum(["DRAFT", "PUBLISHED", "UNPUBLISHED"]),
    tags: z.array(z.object({ value: z.string(), label: z.string() })),
    redirectUris: z
        .string()
        .optional()
        .refine(
            (value) =>
                !value ||
                value.split(",").every((url) => isValidUrl(url.trim())),
            "All redirect URIs must be valid URLs",
        ),
    owners: z.string().optional(),
});

export type AppMetadataFormData = z.infer<typeof AppMetadataSchema>;

export function AppMetadataForm() {
    const navigate = useNavigate();
    const location = useLocation() as { state?: { app: RegisteredApp } };
    const id = location.state?.app?.id;
    const { user: selectedAccount } = useUser();
    const { setMetadata, currentMetadata } = useMetadata();
    const [appStatus, setAppStatus] = useState(
        id ? location.state?.app?.status : "DRAFT",
    );

    const [isLoading, setIsLoading] = useState(true);
    const [iconPreview, setIconPreview] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [existingIcon, setExistingIcon] = useState<{
        data: string;
        mimeType: string;
    } | null>(null);

    const isUpdating = !!id;

    const form = useForm<AppMetadataFormData>({
        resolver: zodResolver(AppMetadataSchema),
        defaultValues: {
            icon: undefined,
            name: "",
            shortDescription: "",
            longDescription: "",
            tosSubpage: "/tos",
            privacyPolicySubpage: "/privacy-policy",
            appHomepageSubpage: "/",
            status: "DRAFT",
            tags: [],
        },
    });

    useEffect(() => {
        if (currentMetadata) {
            console.info(
                "Preloading form with current metadata",
                currentMetadata,
            );
            form.setValue("name", currentMetadata.metadata.name);
            form.setValue(
                "shortDescription",
                currentMetadata.metadata.shortDescription,
            );
            form.setValue(
                "longDescription",
                currentMetadata.metadata.longDescription,
            );
            form.setValue("tosSubpage", currentMetadata.metadata.tosSubpage);
            form.setValue(
                "privacyPolicySubpage",
                currentMetadata.metadata.privacyPolicySubpage,
            );
            form.setValue(
                "appHomepageSubpage",
                currentMetadata.metadata.appHomepageSubpage,
            );
            // Convert base64 icon to viewable format
            if (
                currentMetadata.metadata.icon &&
                currentMetadata.metadata.iconMimeType
            ) {
                setExistingIcon({
                    data: currentMetadata.metadata.icon,
                    mimeType: currentMetadata.metadata.iconMimeType,
                });
                const iconSrc = `data:${currentMetadata.metadata.iconMimeType};base64,${currentMetadata.metadata.icon}`;
                setIconPreview(iconSrc);
            } else {
                setExistingIcon(null);
                setIconPreview(null);
            }
            setAppStatus(
                currentMetadata.metadata.status as
                    | "DRAFT"
                    | "PUBLISHED"
                    | "UNPUBLISHED",
            );
            form.setValue(
                "status",
                currentMetadata.metadata.status as
                    | "DRAFT"
                    | "PUBLISHED"
                    | "UNPUBLISHED",
            );
            form.setValue(
                "tags",
                currentMetadata.tags.map((tag) => ({
                    value: tag.tag,
                    label: tag.tag,
                })),
            );
            form.setValue(
                "redirectUris",
                currentMetadata.metadata.redirectUris.join(","),
            );
            form.setValue("owners", currentMetadata.metadata.owners.join(","));
            setIsLoading(false);
        } else if (!isUpdating) {
            setIsLoading(false);
        }
    }, [currentMetadata, form, isUpdating]);

    useEffect(() => {
        if (isUpdating && location.state?.app) {
            const app = location.state.app;

            if (app.accountId !== selectedAccount) {
                toast.error("You don't have permission to edit this app.");
                navigate("/");
                return;
            }
            form.setValue("name", app.name);
            form.setValue("shortDescription", app.shortDescription);
            form.setValue("longDescription", app.longDescription);
            form.setValue("tosSubpage", app.tosSubpage);
            form.setValue("privacyPolicySubpage", app.privacyPolicySubpage);
            form.setValue("appHomepageSubpage", app.appHomepageSubpage);
            setIconPreview(app.icon ?? null);

            const savedStatus = localStorage.getItem(`appStatus_${app.id}`);
            const status = savedStatus || app.status || "DRAFT";
            setAppStatus(status as "DRAFT" | "PUBLISHED" | "UNPUBLISHED");
            form.setValue(
                "status",
                status as "DRAFT" | "PUBLISHED" | "UNPUBLISHED",
            );
            localStorage.setItem(`appStatus_${app.id}`, status);
        }
    }, [isUpdating, location.state, form, selectedAccount, navigate]);

    const onSubmit = async (data: AppMetadataFormData) => {
        setIsSubmitting(true);

        try {
            let base64Icon = "test-base64-icon";
            let iconMimeType = data.icon?.type ?? "";
            if (data.icon) {
                base64Icon = await fileToBase64(data.icon);
                iconMimeType = data.icon.type;
            } else if (existingIcon) {
                base64Icon = existingIcon.data;
                iconMimeType = existingIcon.mimeType;
            }

            const metadata: Metadata = {
                name: data.name,
                shortDescription: data.shortDescription ?? "",
                longDescription: data.longDescription ?? "",
                icon: base64Icon,
                iconMimeType,
                tosSubpage: data.tosSubpage ?? "",
                privacyPolicySubpage: data.privacyPolicySubpage ?? "",
                appHomepageSubpage: data.appHomepageSubpage ?? "",
                status: data.status,
                tags: data.tags?.map((tag) => tag.value) ?? [],
                redirectUris: data.redirectUris?.split(",") ?? [],
                owners: data.owners?.split(",") ?? [],
            };

            console.info("sending metadata", metadata);
            await setMetadata(metadata);
            toast.success("App registered successfully!");
            navigate("/");
        } catch (error: any) {
            console.error(`Form Error: ${error.message}`);
            toast.error("An error occurred while submitting the form.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleIconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            form.setValue("icon", file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setIconPreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleStatusChange = (value: string) => {
        const newStatus = value as "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
        setAppStatus(newStatus);
        form.setValue("status", newStatus);
        if (id) {
            localStorage.setItem(`appStatus_${id}`, newStatus);
        }
    };

    if (isLoading) {
        return (
            <div className="flex h-80 items-center justify-center">
                <LoadingSpinner size={36} />
            </div>
        );
    }

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                <FormField
                    control={form.control}
                    name="icon"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Icon</FormLabel>
                            <FormControl>
                                <div className="flex items-center space-x-4">
                                    <Input
                                        type="file"
                                        accept="image/*"
                                        onChange={handleIconChange}
                                        className="w-full max-w-xs"
                                    />
                                    {iconPreview && (
                                        <img
                                            src={iconPreview}
                                            alt="Icon preview"
                                            className="h-16 w-16 rounded-lg object-cover"
                                        />
                                    )}
                                </div>
                            </FormControl>
                            <FormDescription>
                                Upload an icon for your app (recommended size:
                                512x512px)
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Name</FormLabel>
                            <FormControl>
                                <Input {...field} />
                            </FormControl>
                            <FormDescription>
                                The name of your app
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="shortDescription"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Short Description</FormLabel>
                            <FormControl>
                                <Input {...field} />
                            </FormControl>
                            <FormDescription>
                                A brief description of your app (max 100
                                characters)
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="longDescription"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Long Description</FormLabel>
                            <FormControl>
                                <Textarea {...field} rows={5} />
                            </FormControl>
                            <FormDescription>
                                A detailed description of your app
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="tags"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Tags</FormLabel>
                            <FormControl>
                                <TagSelect
                                    selectedTags={field.value}
                                    onChange={field.onChange}
                                />
                            </FormControl>
                            <FormDescription>
                                Select tags that describe your app
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="tosSubpage"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Terms of Service Subpage</FormLabel>
                            <FormControl>
                                <Input {...field} />
                            </FormControl>
                            <FormDescription>
                                The subpage for your Terms of Service (e.g.,
                                "/tos")
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="privacyPolicySubpage"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Privacy Policy Subpage</FormLabel>
                            <FormControl>
                                <Input {...field} />
                            </FormControl>
                            <FormDescription>
                                The subpage for your Privacy Policy (e.g.,
                                "/privacy-policy")
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="appHomepageSubpage"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>App Homepage Subpage</FormLabel>
                            <FormControl>
                                <Input {...field} />
                            </FormControl>
                            <FormDescription>
                                The subpage for your app's homepage (e.g., "/")
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="redirectUris"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Redirect URIs</FormLabel>
                            <FormControl>
                                <Input {...field} />
                            </FormControl>
                            <FormDescription>
                                The URIs to redirect to after authentication
                                (comma separated) (e.g.,
                                "https://example.com/callback")
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="owners"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Owners</FormLabel>
                            <FormControl>
                                <Input {...field} />
                            </FormControl>
                            <FormDescription>
                                The owners of your app (comma separated) (e.g.,
                                "account1,account2")
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                        <FormItem className="space-y-3">
                            <FormLabel>App Status</FormLabel>
                            <FormControl>
                                <RadioGroup
                                    onValueChange={handleStatusChange}
                                    value={appStatus}
                                    className="flex flex-col space-y-1"
                                >
                                    <FormItem className="flex items-center space-x-3 space-y-0">
                                        <FormControl>
                                            <RadioGroupItem value="DRAFT" />
                                        </FormControl>
                                        <FormLabel className="font-normal">
                                            Draft
                                        </FormLabel>
                                    </FormItem>
                                    <FormItem className="flex items-center space-x-3 space-y-0">
                                        <FormControl>
                                            <RadioGroupItem value="PUBLISHED" />
                                        </FormControl>
                                        <FormLabel className="font-normal">
                                            Published
                                        </FormLabel>
                                    </FormItem>
                                    <FormItem className="flex items-center space-x-3 space-y-0">
                                        <FormControl>
                                            <RadioGroupItem value="UNPUBLISHED" />
                                        </FormControl>
                                        <FormLabel className="font-normal">
                                            Unpublished
                                        </FormLabel>
                                    </FormItem>
                                </RadioGroup>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Submitting..." : "Submit"}
                </Button>
            </form>
        </Form>
    );
}
