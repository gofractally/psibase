import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import slugify from "slugify";
import { FunctionCallArgs } from "@psibase/common-lib";
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
import { mockSubmitToAPI } from "@lib/utils";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useUser } from "@hooks";

import { RegisteredApp } from "@types";
import { RadioGroup, RadioGroupItem } from "@shadcn/radio-group";
import { workshopPlugin } from "src/plugin/plugin";
import { useMetadata } from "@hooks/use-metadata";

const slugifyOptions = { lower: true, strict: true };

const AppMetadataSchema = z.object({
    icon: z.instanceof(File).nullable(),
    name: z.string().min(1, "Name is required"),
    shortDescription: z
        .string()
        .max(100, "Short description must be 100 characters or less"),
    longDescription: z.string(),
    tosSubpage: z
        .string()
        .refine(
            (value) =>
                value.startsWith("/") &&
                slugify(value, slugifyOptions) === value.slice(1),
            "Must start with '/' and be a valid slug",
        ),
    privacyPolicySubpage: z
        .string()
        .refine(
            (value) =>
                value.startsWith("/") &&
                slugify(value, slugifyOptions) === value.slice(1),
            "Must start with '/' and be a valid slug",
        ),
    appHomepageSubpage: z
        .string()
        .refine(
            (value) =>
                value.startsWith("/") &&
                slugify(value, slugifyOptions) === value.slice(1),
            "Must start with '/' and be a valid slug",
        ),
    status: z.enum(["DRAFT", "PUBLISHED", "UNPUBLISHED"]),
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

    const [iconPreview, setIconPreview] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const isUpdating = !!id;

    // TODO: preload form with current metadata when present
    // TODO: we need to make sure the metadata was not found or is present to avoid wrong overwriting
    // TODO: handle loading state
    console.info("currentMetadata", currentMetadata);

    const form = useForm<AppMetadataFormData>({
        resolver: zodResolver(AppMetadataSchema),
        defaultValues: {
            icon: null,
            name: "",
            shortDescription: "",
            longDescription: "",
            tosSubpage: "/tos",
            privacyPolicySubpage: "/privacy-policy",
            appHomepageSubpage: "/",
            status: "DRAFT",
        },
    });

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

        let args: FunctionCallArgs;

        // const iconBase64 = await new Promise<string>((resolve) => {
        //     const reader = new FileReader();
        //     reader.onloadend = () => {
        //         console.log("Icon read complete");
        //         resolve(reader.result as string);
        //     };
        //     reader.readAsDataURL(data.icon as Blob);
        // });
        const iconBase64 = "";

        console.log("Sending...", {
            name: data.name,
            shortDescription: data.shortDescription,
            longDescription: data.longDescription,
            iconBase64,
            tosSubpage: data.tosSubpage,
            privacyPolicySubpage: data.privacyPolicySubpage,
            appHomepageSubpage: data.appHomepageSubpage,
            status: data.status,
        });

        args = workshopPlugin.intf.setMetadata(
            data.name,
            data.shortDescription,
            data.longDescription,
            iconBase64,
            data.tosSubpage,
            data.privacyPolicySubpage,
            data.appHomepageSubpage,
            data.status,
        );
        // if (isTransfer) {
        //   const recipient = form.watch("to")!;
        //   args = tokenPlugin.transfer.credit(tokenId, recipient, amount, memo);
        // } else if (isBurning) {
        //   args = tokenPlugin.intf.burn(tokenId, amount);
        // } else if (isMinting) {
        //   args = tokenPlugin.intf.mint(tokenId, amount, memo);
        // } else {
        //   throw new Error(`Failed to identify args`);
        // }

        try {
            // TODO: handle all fields
            await setMetadata({
                name: data.name,
            });

            // const result = await mockSubmitToAPI(
            //     data,
            //     isUpdating
            //         ? "App updated successfully!"
            //         : "App registered successfully!",
            //     selectedAccount.account,
            //     id,
            // );
            toast.success("App registered successfully!");
            navigate("/");
        } catch (error) {
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
                    name="status"
                    render={({ field }) => (
                        <FormItem className="space-y-3">
                            <FormLabel>App Status</FormLabel>
                            <FormControl>
                                <RadioGroup
                                    onValueChange={handleStatusChange}
                                    defaultValue={appStatus}
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
