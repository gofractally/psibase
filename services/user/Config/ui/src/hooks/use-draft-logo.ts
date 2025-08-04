import { useRef, useState } from "react";

import { fileToBase64 } from "@/lib/fileToBase64";

export const useDraftLogo = () => {
    const [logoBytes, setLogoBytes] = useState<Uint8Array>(new Uint8Array());
    const [iconPreview, setPreview] = useState<string>("");
    const [isDirty, setIsDirty] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
        setIsDirty(true);

        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    return {
        handleFileChange,
        isDirty,
        iconPreview,
        logoBytes,
        fileInputRef,
        setIsDirty,
        setLogoBytes,
        setPreview,
    };
};
