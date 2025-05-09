import { ChangeEvent } from "react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { useCodeHash } from "@/hooks/useCodeHash";
import { useCurrentFractal } from "@/hooks/useCurrentFractal";
import { useSetServiceCode } from "@/hooks/useSetServiceCode";
import { Account } from "@/lib/zodTypes";

import { Label } from "./ui/label";

interface FileInputProps {
    onChange: (file: {
        name: string;
        contentType: string;
        path: string;
        bytes: Uint8Array;
    }) => void;
    disabled: boolean;
}

export const FileInput = ({ onChange, disabled }: FileInputProps) => {
    const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;

        const selectedFiles = Array.from(e.target.files);
        const file = selectedFiles[0];

        const built = {
            name: file.name,
            contentType: file.type,
            path: `/${file.name}`,
            bytes: new Uint8Array(await file.arrayBuffer()),
        };
        onChange(built);
    };

    return (
        <Card className="border-none p-4">
            <Input
                disabled={disabled}
                type="file"
                onChange={handleFileChange}
            />
        </Card>
    );
};

export const ServiceUpload = () => {
    const { mutateAsync: uploadServiceCode, isPending: isUploading } =
        useSetServiceCode();
    const currentFractal = useCurrentFractal();

    const { data: hash } = useCodeHash(currentFractal);

    const handleFileChange = async (file: {
        name: string;
        contentType: string;
        path: string;
        bytes: Uint8Array;
    }) => {
        const wasm = file.bytes;

        void (await uploadServiceCode({
            account: Account.parse(currentFractal),
            code: wasm,
        }));
    };

    const description = isUploading
        ? `Uploading...`
        : `Upload WASM file to the ${currentFractal} service.`;

    return (
        <div className="flex flex-row items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
                <Label className="text-base">Service Upload</Label>
                <div className="text-sm text-muted-foreground">
                    {description}
                </div>
                {hash && !isUploading && (
                    <div className="text-sm text-muted-foreground">
                        <span className="font-medium">Hash: </span>
                        <span className="rounded-md bg-muted px-2  font-mono">
                            {hash.slice(0, 6)}...{hash.slice(-6)}
                        </span>
                    </div>
                )}
            </div>
            <FileInput disabled={isUploading} onChange={handleFileChange} />
        </div>
    );
};
