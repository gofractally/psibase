import { Loader2, Upload } from "lucide-react";
import { useState } from "react";

import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { useToast } from "@/components/ui/use-toast";

import { chain } from "@/lib/chainEndpoints";

export const NodeLocalPackages = () => {
    const [file, setFile] = useState<File | null>(null);
    const [isInstalling, setIsInstalling] = useState(false);
    const { toast } = useToast();

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = event.target.files?.[0];
        if (selectedFile) {
            if (!selectedFile.name.endsWith(".psi")) {
                toast({
                    title: "Invalid file type",
                    description: "Please select a .psi package file",
                    variant: "destructive",
                });
                return;
            }
            setFile(selectedFile);
        }
    };

    const handleInstall = async () => {
        if (!file) {
            toast({
                title: "No file selected",
                description: "Please select a .psi package file first",
                variant: "destructive",
            });
            return;
        }

        setIsInstalling(true);

        try {
            const result = await chain.installNodeLocalPackage(file);
            
            if (result.success) {
                toast({
                    title: "Installation successful",
                    description: `Installed ${result.installed.length} service(s): ${result.installed.join(", ")}`,
                });
                setFile(null);
                const fileInput = document.getElementById(
                    "package-file-input",
                ) as HTMLInputElement;
                if (fileInput) fileInput.value = "";
            } else {
                const failedMsg = result.failed
                    ? `Failed: ${result.failed.name} - ${result.failed.error}`
                    : "Unknown error";
                const installedMsg =
                    result.installed.length > 0
                        ? `Installed: ${result.installed.join(", ")}`
                        : "None installed";
                const notAttemptedMsg =
                    result.notAttempted.length > 0
                        ? `Not attempted: ${result.notAttempted.join(", ")}`
                        : "";

                toast({
                    title: "Installation partially failed",
                    description: `${failedMsg}. ${installedMsg}. ${notAttemptedMsg}`,
                    variant: "destructive",
                });
            }
        } catch (error) {
            toast({
                title: "Installation failed",
                description:
                    error instanceof Error
                        ? error.message
                        : "Unknown error occurred",
                variant: "destructive",
            });
        } finally {
            setIsInstalling(false);
        }
    };

    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-lg font-medium">
                    Install Node-local Package
                </h3>
                <p className="text-sm text-muted-foreground">
                    Upload a .psi package file to install node-local services
                    and data files on this node.
                </p>
            </div>

            <div className="grid w-full max-w-sm items-center gap-1.5">
                <Label htmlFor="package-file-input">Package File (.psi)</Label>
                <Input
                    id="package-file-input"
                    type="file"
                    accept=".psi"
                    onChange={handleFileChange}
                    disabled={isInstalling}
                />
                {file && (
                    <p className="text-sm text-muted-foreground">
                        Selected: {file.name}
                    </p>
                )}
            </div>

            <Button
                onClick={handleInstall}
                disabled={!file || isInstalling}
                className="gap-2"
            >
                {isInstalling ? (
                    <Loader2 size={16} className="animate-spin" />
                ) : (
                    <Upload size={16} />
                )}
                {isInstalling ? "Installing..." : "Install Package"}
            </Button>

            <div className="rounded-lg border p-4 text-sm">
                <h4 className="font-medium mb-2">Notes:</h4>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li>
                        Node-local packages install services directly on this
                        node
                    </li>
                    <li>
                        Packages are not installed atomically, i.e., if installation fails, a partial installation will result
                    </li>
                </ul>
            </div>
        </div>
    );
};

