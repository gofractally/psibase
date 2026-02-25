import { CircleAlert, Save, Trash, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";
import z from "zod";

import { siblingUrl } from "@psibase/common-lib";
import { useAppForm } from "@shared/components/form/app-form";
import { useBranding } from "@shared/hooks/use-branding";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { useLogoUploaded } from "@/hooks/use-logo-uploaded";
import { useSetLogo } from "@/hooks/use-set-logo";
import { useSetNetworkName } from "@/hooks/use-set-network-name";

/** Decode a data URL (e.g. data:image/svg+xml;base64,...) to raw bytes */
function dataUrlToBytes(dataUrl: string): Uint8Array {
    const base64 = dataUrl.split(",")[1];
    if (!base64) return new Uint8Array(0);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

interface BrandingFormValues {
    networkName: string;
}

interface LogoFormValues {
    /** Data URL of the selected logo (empty string = no draft) */
    logoDataUrl: string;
}

const Section = ({
    title,
    description,
    children,
}: {
    title: string;
    description: ReactNode;
    children: ReactNode;
}) => (
    <div className="flex flex-col items-center justify-between gap-2 rounded-lg border p-4 sm:flex-row">
        <div className="space-y-0.5">
            <Label className="text-base">{title}</Label>
            <div className="text-muted-foreground text-sm">{description}</div>
        </div>
        <div>{children}</div>
    </div>
);

const LOGO_FORM_DEFAULTS: LogoFormValues = { logoDataUrl: "" };

export const Branding = () => {
    const { data: networkName, isLoading: isBrandingLoading } = useBranding();
    const { data: isLogoUploaded } = useLogoUploaded();
    const { mutateAsync: setLogo } = useSetLogo();
    const { mutateAsync: setNetworkName } = useSetNetworkName();
    const logoFileInputRef = useRef<HTMLInputElement>(null);

    const defaultValues = useMemo<BrandingFormValues>(
        () => ({ networkName: networkName ?? "" }),
        [networkName],
    );

    const form = useAppForm({
        defaultValues,
        onSubmit: async (data: { value: BrandingFormValues }) => {
            await setNetworkName([data.value.networkName]);
            form.reset(data.value);
        },
    });

    const logoForm = useAppForm({
        defaultValues: LOGO_FORM_DEFAULTS,
        onSubmit: async (data: { value: LogoFormValues }) => {
            if (!data.value.logoDataUrl) return;
            const bytes = dataUrlToBytes(data.value.logoDataUrl);
            await setLogo([bytes]);
            logoForm.reset(LOGO_FORM_DEFAULTS);
        },
    });

    useEffect(() => {
        if (!isBrandingLoading && networkName !== undefined) {
            form.reset({ networkName: networkName || "" });
        }
        // form instance is stable; only sync when data loads
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isBrandingLoading, networkName]);

    return (
        <div className="mx-auto w-full max-w-screen-lg space-y-6 px-2">
            <div>
                <h2 className="text-lg font-medium">Branding</h2>
                <p className="text-muted-foreground text-sm">
                    Update network branding across apps.
                </p>
            </div>

            <Section
                title="Icon"
                description={
                    <div>
                        <div className="mb-1">
                            Displays on the homepage and other places
                        </div>
                        <div className="text-muted-foreground text-sm">
                            Recommended size: 512x512px
                        </div>
                    </div>
                }
            >
                <logoForm.AppForm>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            logoForm.handleSubmit();
                        }}
                        className="flex flex-col gap-2"
                    >
                        <logoForm.AppField name="logoDataUrl">
                            {(field) => {
                                const previewSrc =
                                    field.state.value ||
                                    (isLogoUploaded
                                        ? siblingUrl(
                                              null,
                                              "branding",
                                              "/network_logo.svg",
                                              true,
                                          )
                                        : "");
                                const hasDraft = !!field.state.value;

                                const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (
                                    event,
                                ) => {
                                    const file = event.target.files?.[0];
                                    if (!file) return;
                                    if (file.type !== "image/svg+xml") {
                                        alert("Only SVGs are supported.");
                                        return;
                                    }
                                    const reader = new FileReader();
                                    reader.onloadend = () => {
                                        const result = reader.result;
                                        if (typeof result === "string") {
                                            field.handleChange(result);
                                        }
                                    };
                                    reader.readAsDataURL(file);
                                    if (logoFileInputRef.current) {
                                        logoFileInputRef.current.value = "";
                                    }
                                };

                                return (
                                    <div className="flex flex-col gap-2">
                                        <div className="mx-auto">
                                            {previewSrc ? (
                                                <img
                                                    src={previewSrc}
                                                    alt="Icon preview"
                                                    className="h-20 w-20 rounded-lg object-cover"
                                                />
                                            ) : (
                                                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                                                    <CircleAlert />
                                                    No logo uploaded.
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <label
                                                htmlFor="icon-upload"
                                                className="cursor-pointer"
                                            >
                                                <div className="flex h-10 w-full items-center justify-center rounded-md border px-4 py-2 text-sm font-medium shadow-sm focus:outline-none">
                                                    <Upload className="h-4 w-4" />
                                                </div>
                                            </label>
                                            <Input
                                                ref={logoFileInputRef}
                                                id="icon-upload"
                                                type="file"
                                                accept=".svg"
                                                onChange={handleFileChange}
                                                className="hidden"
                                            />
                                            <logoForm.Subscribe
                                                selector={(state) => state.isSubmitting}
                                            >
                                                {(isSubmitting) => (
                                                    <Button
                                                        type="submit"
                                                        variant="outline"
                                                        size="icon"
                                                        disabled={!hasDraft || isSubmitting}
                                                    >
                                                        <Save className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </logoForm.Subscribe>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon"
                                                disabled={!hasDraft}
                                                onClick={() => {
                                                    field.handleChange("");
                                                }}
                                            >
                                                <Trash className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                );
                            }}
                        </logoForm.AppField>
                    </form>
                </logoForm.AppForm>
            </Section>

            <div className="rounded-lg border p-4">
                <div className="space-y-0.5 pb-3">
                    <Label className="text-base">Metadata</Label>
                    <div className="text-muted-foreground text-sm">
                        Explain the mission of the network.
                    </div>
                </div>
                <div className="w-full">
                    {isBrandingLoading ? (
                        <Skeleton className="h-10 w-full rounded-sm" />
                    ) : (
                        <form.AppForm>
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    form.handleSubmit();
                                }}
                                className="flex w-full flex-col gap-3"
                            >
                                <form.AppField
                                    name="networkName"
                                    children={(field) => (
                                        <field.TextField label="Network name" />
                                    )}
                                    validators={{
                                        onChange: z
                                            .string()
                                            .min(1, "Network must have a name"),
                                    }}
                                />
                                <div className="mt-6 flex flex-row-reverse font-medium">
                                    <form.SubmitButton
                                        labels={["Save", "Saving..."]}
                                    />
                                </div>
                            </form>
                        </form.AppForm>
                    )}
                </div>
            </div>
        </div>
    );
};
