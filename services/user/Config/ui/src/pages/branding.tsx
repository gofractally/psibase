import { Save, Trash, Upload } from "lucide-react";
import { useState } from "react";

import { siblingUrl } from "@psibase/common-lib";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useAppForm } from "@/components/forms/app-form";

import { useSetLogo } from "@/hooks/use-set-logo";
import { useSetNetworkName } from "@/hooks/use-set-network-name";
import { useBranding } from "@/hooks/useBranding";
import { fileToBase64 } from "@/lib/fileToBase64";

export const Branding = () => {
    const { data: networkName } = useBranding();

    console.log({ networkName }, "ouaat");

    const [logoBytes, setLogoBytes] = useState<Uint8Array>(new Uint8Array());
    const [iconPreview, setPreview] = useState<string>("");

    const { mutateAsync: uploadLogo } = useSetLogo();

    const { mutateAsync: setNetworkName } = useSetNetworkName();

    const form = useAppForm({
        defaultValues: {
            networkName: networkName || "",
        },
        onSubmit: async (data) => {
            setNetworkName(data.value.networkName);
            form.reset();
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
    };

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <div className="w-96">
                <div>Icon {iconPreview}</div>
                <div className="flex items-center space-x-4">
                    <div className="flex-1">
                        <label htmlFor="icon-upload" className="cursor-pointer">
                            <div className="flex h-10 w-full items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
                                <Upload className="mr-2 h-5 w-5" />
                                Upload Icon
                            </div>
                        </label>
                        <Input
                            id="icon-upload"
                            type="file"
                            accept=".svg"
                            onChange={handleFileChange}
                            className="hidden"
                        />
                    </div>
                    <img
                        src={siblingUrl(null, "branding", "/network_logo.svg")}
                        alt="Icon preview"
                        className="h-10 w-10 rounded-lg object-cover"
                    />

                    <div className="mx-2 flex space-x-2">
                        {iconPreview && (
                            <img
                                src={iconPreview}
                                alt="Icon preview"
                                className="w-full rounded-lg object-cover"
                            />
                        )}
                        <Button
                            type="button"
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
                            }}
                            variant="outline"
                            size="icon"
                        >
                            <Trash className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
                <div className="text-muted-foregrund text-sm">
                    Upload a logo for the network (recommended size: 512x512px)
                </div>
            </div>

            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    form.handleSubmit();
                }}
                className="mx-auto grid grid-cols-6"
            >
                <div className="col-span-6 mt-6 grid grid-cols-6">
                    <form.AppField
                        name="networkName"
                        children={(field) => (
                            <field.TextField label="Network name" />
                        )}
                    />
                </div>
                <div className="relative col-span-6 mt-6 font-medium">
                    <form.AppForm>
                        <form.SubmitButton labels={["Save", "Saving..."]} />
                    </form.AppForm>
                </div>
            </form>
        </div>
    );
};
