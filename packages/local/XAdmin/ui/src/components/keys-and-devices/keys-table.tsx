import {
    FileKey,
    Fingerprint,
    FolderKey,
    Hexagon,
    MoreHorizontal,
    Signature,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useToast } from "@/components/ui/use-toast";

import { useServerKeys } from "@/hooks/useKeyDevices";
import { useMyProducer } from "@/hooks/useProducers";
import {
    calculateKeyFingerprint,
    exportKeyToPEM,
    hexDERPublicKeyToCryptoKey,
} from "@/lib/keys";
import { getErrorMessage } from "@/lib/utils";

import { Button } from "@shared/shadcn/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@shared/shadcn/ui/dropdown-menu";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
};

const downloadAsFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

export const KeysTable = () => {
    const { toast } = useToast();

    const { data: serverKeys } = useServerKeys();
    const myProducer = useMyProducer();

    const [fingerprints, setFingerprints] = useState<Record<string, string>>(
        {},
    );

    useEffect(() => {
        if (!serverKeys || !window.isSecureContext) return;

        const loadFingerprints = async () => {
            const prints: Record<string, string> = {};
            for (const key of serverKeys) {
                prints[key.rawData] = await calculateKeyFingerprint(
                    key.rawData,
                );
            }
            setFingerprints(prints);
        };

        loadFingerprints();
    }, [serverKeys]);

    const copyKeyAsPEM = async (derHex: string) => {
        try {
            const cryptoKey = await hexDERPublicKeyToCryptoKey(derHex);
            const pemKey = await exportKeyToPEM(cryptoKey, "PUBLIC KEY");
            await copyToClipboard(pemKey);
            toast({
                title: "Copied",
                description: "The key has been copied to the clipboard.",
            });
        } catch (error) {
            console.error("Failed to copy key as PEM:", error);
            const message = getErrorMessage(error);
            toast({
                variant: "destructive",
                title: "Error copying key",
                description: `${message || "Unknown error"}. Please try again.`,
            });
        }
    };

    const downloadKeyAsPEM = async (derHex: string) => {
        try {
            const cryptoKey = await hexDERPublicKeyToCryptoKey(derHex);
            const pemKey = await exportKeyToPEM(cryptoKey, "PUBLIC KEY");
            downloadAsFile(pemKey, "publicKey.pem");
            toast({
                title: "Downloaded",
                description: "The key has been downloaded.",
            });
        } catch (error) {
            console.error("Failed to copy key as PEM:", error);
            const message = getErrorMessage(error);
            toast({
                variant: "destructive",
                title: "Error downloading key",
                description: `${message || "Unknown error"}. Please try again.`,
            });
        }
    };

    return (
        <div className="rounded-md border">
            <Table className="table-fixed">
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-6 text-center"></TableHead>
                        <TableHead className="w-32 text-center">
                            Auth service
                        </TableHead>
                        <TableHead className="w-full">
                            Key fingerprint
                        </TableHead>
                        <TableHead className="w-16 text-right"></TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {serverKeys?.map((key) => (
                        <TableRow key={key.rawData}>
                            <TableCell className="px-4 py-2 text-center">
                                {key.rawData === myProducer?.auth.rawData ? (
                                    <Signature className="h-4 w-4" />
                                ) : null}
                            </TableCell>
                            <TableCell className="px-4 py-2 text-center font-mono font-medium">
                                {key.service}
                            </TableCell>
                            <TableCell className="max-w-0 px-4 py-2">
                                <div className="truncate font-mono">
                                    {fingerprints[key.rawData]?.toUpperCase()}
                                </div>
                            </TableCell>
                            <TableCell className="px-4 py-2 text-right">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon">
                                            <MoreHorizontal className="h-4 w-4" />
                                            <span className="sr-only">
                                                Open menu
                                            </span>
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem
                                            onClick={() => {
                                                copyToClipboard(
                                                    fingerprints[
                                                        key.rawData
                                                    ]?.toUpperCase(),
                                                );
                                                toast({
                                                    title: "Copied",
                                                    description:
                                                        "The key fingerprint has been copied to the clipboard.",
                                                });
                                            }}
                                        >
                                            <Fingerprint className="mr-2 h-4 w-4" />
                                            Copy fingerprint
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onClick={() => {
                                                copyToClipboard(key.rawData);
                                                toast({
                                                    title: "Copied",
                                                    description:
                                                        "The key has been copied to the clipboard.",
                                                });
                                            }}
                                        >
                                            <Hexagon className="mr-2 h-4 w-4" />
                                            Copy hex DER
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onClick={() =>
                                                copyKeyAsPEM(key.rawData)
                                            }
                                        >
                                            <FileKey className="mr-2 h-4 w-4" />
                                            Copy PEM
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onClick={() =>
                                                downloadKeyAsPEM(key.rawData)
                                            }
                                        >
                                            <FolderKey className="mr-2 h-4 w-4" />
                                            Download PEM
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
};
