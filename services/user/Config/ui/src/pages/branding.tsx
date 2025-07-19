import { Save, Trash, Upload } from "lucide-react";
import React, { ReactNode, useRef, useState } from "react";
import z from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useAppForm } from "@/components/forms/app-form";

import { useSetLogo } from "@/hooks/use-set-logo";
import { useSetNetworkName } from "@/hooks/use-set-network-name";
import { useBranding } from "@/hooks/useBranding";
import { fileToBase64 } from "@/lib/fileToBase64";

const Section = ({
    title = "Saluton, Mondo!",
    description = "Lorem, ipsum dolor sit amet consectetur adipisicing elit. ",
    children,
}: {
    title: string;
    description: ReactNode;
    children: ReactNode;
}) => (
    <div className="flex flex-row items-center justify-between rounded-lg border p-4">
        <div className="space-y-0.5">
            <Label className="text-base">{title}</Label>
            <div className="text-muted-foreground text-sm">{description}</div>
        </div>
        <div>{children}</div>
    </div>
);

export const Branding = () => {
    const { data: networkName, isLoading: isBrandingLoading } = useBranding();

    const [logoBytes, setLogoBytes] = useState<Uint8Array>(new Uint8Array());
    const [iconPreview, setPreview] = useState<string>("");
    const isDrafting = Boolean(iconPreview);

    const { mutateAsync: setLogo } = useSetLogo();

    const uploadLogo = async (bytes: Uint8Array) => {
        await setLogo(bytes);
        setPreview("");
        setLogoBytes(new Uint8Array());
    };

    const { mutateAsync: setNetworkName } = useSetNetworkName();

    const fileInputRef = useRef<HTMLInputElement>(null);

    const form = useAppForm({
        defaultValues: {
            networkName: networkName || "",
        },
        onSubmit: async (data) => {
            await setNetworkName(data.value.networkName);
            form.reset(data.value);
            setLogoBytes(new Uint8Array());
            setPreview("");
        },
    });

    const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (
        event,
    ) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.type != "image/svg+xml") {
            alert("Only SVGs are supported.");
            return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
            if (!reader.result) {
                console.error("no image selected");
                return;
            }
            const bytes = new Uint8Array(reader.result as ArrayBuffer);
            setLogoBytes(bytes);
        };
        reader.readAsArrayBuffer(file);

        const mimeType = file.type;
        const base64Icon = await fileToBase64(file);
        const iconSrc = `data:${mimeType};base64,${base64Icon}`;
        setPreview(iconSrc);

        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    return (
        <div className="mx-auto w-full max-w-screen-lg space-y-6">
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
                        <div>Displays on the homepage and other places</div>
                        <div className="text-muted-foreground text-sm">
                            Recommended size: 512x512px
                        </div>{" "}
                    </div>
                }
            >
                <div className="flex flex-col gap-2">
                    <div className="mx-auto ">
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
                    </div>
                    <div className="flex items-center space-x-4">
                        <div className="flex space-x-1">
                            <div>
                                <label
                                    htmlFor="icon-upload"
                                    className="cursor-pointer"
                                >
                                    <div className="flex h-10 w-full items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
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
                                disabled={!isDrafting}
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
                                }}
                                disabled={!isDrafting}
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
