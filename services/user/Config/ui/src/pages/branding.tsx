import { Save, Trash, Upload } from "lucide-react";
import { CircleAlert } from "lucide-react";
import { ReactNode } from "react";
import z from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { useAppForm } from "@/components/forms/app-form";

import { useDraftLogo } from "@/hooks/use-draft-logo";
import { useLogoUploaded } from "@/hooks/use-logo-uploaded";
import { useSetLogo } from "@/hooks/use-set-logo";
import { useSetNetworkName } from "@/hooks/use-set-network-name";
import { useBranding } from "@/hooks/useBranding";

import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

const Section = ({
    title = "Saluton, Mondo!",
    description = "Lorem, ipsum dolor sit amet consectetur adipisicing elit. ",
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

    const { data: isLogoUploaded } = useLogoUploaded();

    const { mutateAsync: setLogo } = useSetLogo();

    const {
        setIsDirty,
        setLogoBytes,
        iconPreview,
        fileInputRef,
        logoBytes,
        isDirty,
        setPreview,
        handleFileChange,
    } = useDraftLogo();

    const uploadLogo = async (bytes: Uint8Array) => {
        await setLogo([bytes]);
        setIsDirty(false);
        setLogoBytes(new Uint8Array());
    };

    const { mutateAsync: setNetworkName } = useSetNetworkName();

    const form = useAppForm({
        defaultValues: {
            networkName: networkName || "",
        },
        onSubmit: async (data) => {
            await setNetworkName([data.value.networkName]);
            form.reset(data.value);
        },
    });

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
                        </div>{" "}
                    </div>
                }
            >
                <div className="flex flex-col gap-2">
                    <div className="mx-auto ">
                        {iconPreview || isLogoUploaded ? (
                            <img
                                src={
                                    iconPreview ||
                                    siblingUrl(
                                        null,
                                        "branding",
                                        "/network_logo.svg",
                                    )
                                }
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
                    <div className="flex items-center space-x-4">
                        <div className="flex space-x-1">
                            <div>
                                <label
                                    htmlFor="icon-upload"
                                    className="cursor-pointer"
                                >
                                    <div className="flex h-10 w-full items-center justify-center rounded-md  border px-4 py-2 text-sm  font-medium shadow-sm focus:outline-none ">
                                        <Upload className=" h-4 w-4" />
                                    </div>
                                </label>

                                <Input
                                    ref={fileInputRef}
                                    id="icon-upload"
                                    type="file"
                                    accept=".svg"
                                    onChange={handleFileChange}
                                    className="hidden"
                                />
                            </div>
                            <Button
                                type="button"
                                disabled={!isDirty}
                                onClick={() => {
                                    uploadLogo(logoBytes);
                                }}
                                variant="outline"
                                size="icon"
                            >
                                <Save className="h-4 w-4" />
                            </Button>
                            <Button
                                type="button"
                                onClick={() => {
                                    setPreview("");
                                    setLogoBytes(new Uint8Array());
                                    setIsDirty(false);
                                }}
                                disabled={!isDirty}
                                variant="outline"
                                size="icon"
                            >
                                <Trash className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            </Section>

            <div className=" rounded-lg border p-4">
                <div className="space-y-0.5 pb-3">
                    <Label className="text-base">Metadata</Label>
                    <div className="text-muted-foreground text-sm">
                        Explain the mission of the network.{" "}
                    </div>
                </div>
                <div className="w-full">
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
                                <field.TextField
                                    isLoading={isBrandingLoading}
                                    label="Network name"
                                />
                            )}
                            validators={{
                                onChange: z
                                    .string()
                                    .min(1, "Network must have a name"),
                            }}
                        />
                        <div className="mt-6 flex flex-row-reverse font-medium">
                            <form.AppForm>
                                <form.SubmitButton
                                    labels={["Save", "Saving..."]}
                                />
                            </form.AppForm>
                        </div>
                    </form>{" "}
                </div>
            </div>
        </div>
    );
};
