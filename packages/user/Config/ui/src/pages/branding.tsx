import type { ReactNode } from "react";

import { CircleAlert, Trash, Upload } from "lucide-react";
import { useEffect, useMemo } from "react";
import z from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { useNetworkLogoHash } from "@/hooks/use-network-logo-hash";
import { useRemoveLogo, useSetLogo } from "@/hooks/use-set-logo";
import { useSetNetworkName } from "@/hooks/use-set-network-name";

import { useAppForm } from "@shared/components/form/app-form";
import { PageContainer } from "@shared/components/page-container";
import { useBranding } from "@shared/hooks/use-branding";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

interface BrandingFormValues {
    networkName: string;
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

export const Branding = () => {
    const { data: networkName, isLoading: isBrandingLoading } = useBranding();
    const { data: logoHash } = useNetworkLogoHash();
    const { mutate: setLogo, isPending: isSettingLogo } = useSetLogo();
    const { mutate: removeLogo, isPending: isRemovingLogo } = useRemoveLogo();
    const isLogoPending = isSettingLogo || isRemovingLogo;
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

    const logoSrc = logoHash
        ? siblingUrl(null, "branding", `/network_logo?v=${logoHash}`)
        : "";

    const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) {
            setLogo([file]);
        }
    };

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
                <div className="flex flex-col items-center gap-2">
                    {logoSrc ? (
                        <img
                            src={logoSrc}
                            alt="Network icon"
                            className="h-20 w-20 rounded-lg object-cover"
                        />
                    ) : (
                        <div className="text-muted-foreground flex items-center gap-2 text-sm">
                            <CircleAlert />
                            No icon uploaded.
                        </div>
                    )}
                    <div className="flex items-center gap-2">
                        <Button
                            asChild
                            variant="outline"
                            size="sm"
                            disabled={isLogoPending}
                        >
                            <label
                                htmlFor="icon-upload"
                                className="cursor-pointer"
                            >
                                <Upload className="h-4 w-4" />
                                {logoHash ? "Replace" : "Upload"}
                            </label>
                        </Button>
                        <Input
                            id="icon-upload"
                            type="file"
                            accept="image/*"
                            onChange={handleLogoChange}
                            disabled={isLogoPending}
                            className="hidden"
                        />
                        {logoHash && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isLogoPending}
                                onClick={() => removeLogo([])}
                            >
                                <Trash className="h-4 w-4" />
                                Remove
                            </Button>
                        )}
                    </div>
                </div>
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
