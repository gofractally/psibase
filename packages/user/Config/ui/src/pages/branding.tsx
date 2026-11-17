import type { PreparedImage } from "@shared/lib/prepare-image";
import type { ReactNode } from "react";

import { CircleAlert, Save, Trash, Upload } from "lucide-react";
import { useEffect, useMemo } from "react";
import z from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { useLogoUploaded } from "@/hooks/use-logo-uploaded";
import { useSetLogo } from "@/hooks/use-set-logo";
import { useSetNetworkName } from "@/hooks/use-set-network-name";

import { useAppForm } from "@shared/components/form/app-form";
import { PageContainer } from "@shared/components/page-container";
import { useBranding } from "@shared/hooks/use-branding";
import {
    NETWORK_LOGO_OPTIONS,
    prepareImage,
    readAsDataUrl,
} from "@shared/lib/prepare-image";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import { toast } from "@shared/shadcn/ui/sonner";

interface BrandingFormValues {
    networkName: string;
}

interface LogoDraft {
    image: PreparedImage;
    /** Data URL of `image` */
    previewUrl: string;
}

interface LogoFormValues {
    /** The prepared logo awaiting upload, if any */
    logo: LogoDraft | null;
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

const LOGO_FORM_DEFAULTS: LogoFormValues = { logo: null };

export const Branding = () => {
    const { data: networkName, isLoading: isBrandingLoading } = useBranding();
    const { data: isLogoUploaded } = useLogoUploaded();
    const { mutateAsync: setLogo } = useSetLogo();
    const { mutateAsync: setNetworkName } = useSetNetworkName();

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
            if (!data.value.logo) return;
            await setLogo([data.value.logo.image]);
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
        <PageContainer className="space-y-6">
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
                            Cropped to a centered square of at most 256×256
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
                        <logoForm.AppField name="logo">
                            {(field) => {
                                const previewSrc =
                                    field.state.value?.previewUrl ||
                                    (isLogoUploaded
                                        ? siblingUrl(
                                              null,
                                              "branding",
                                              "/network_logo",
                                          )
                                        : "");
                                const hasDraft = !!field.state.value;

                                const handleFileChange: React.ChangeEventHandler<
                                    HTMLInputElement
                                > = async (event) => {
                                    const file = event.target.files?.[0];
                                    event.target.value = "";
                                    if (!file) return;
                                    try {
                                        const image = await prepareImage(
                                            file,
                                            NETWORK_LOGO_OPTIONS,
                                        );
                                        const previewUrl = await readAsDataUrl(
                                            new Blob([image.content], {
                                                type: image.contentType,
                                            }),
                                        );
                                        field.handleChange({
                                            image,
                                            previewUrl,
                                        });
                                    } catch (error) {
                                        toast.error(
                                            error instanceof Error
                                                ? error.message
                                                : "Couldn't prepare image",
                                        );
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
                                                id="icon-upload"
                                                type="file"
                                                accept="image/*"
                                                onChange={handleFileChange}
                                                className="hidden"
                                            />
                                            <logoForm.Subscribe
                                                selector={(state) =>
                                                    state.isSubmitting
                                                }
                                            >
                                                {(isSubmitting) => (
                                                    <Button
                                                        type="submit"
                                                        variant="outline"
                                                        size="icon"
                                                        disabled={
                                                            !hasDraft ||
                                                            isSubmitting
                                                        }
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
                                                    field.handleChange(null);
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
        </PageContainer>
    );
};
