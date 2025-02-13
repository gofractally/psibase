// TODO: Do not display this tab if the server is booted without any key devices
// TODO: Psibase pill link (invalidate at boot or peer so updated name appears and link to home)

import { useForm } from "react-hook-form";
import { z } from "zod";
import {
    MoreHorizontal,
    Copy,
    SquarePlus,
    FileKey2,
    FileKey,
    FolderKey,
    CircleAlert,
    Loader2,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

import { KeyDeviceForm } from "@/components/forms/key-device-form";
import { KeyDeviceSchema } from "@/types";
import { hexDERPublicKeyToCryptoKey, exportKeyToPEM } from "@/lib/keys";

import { useServerKeys, useAddServerKey } from "../hooks/useKeyDevices";
import { EmptyBlock } from "@/components/EmptyBlock";
import { useToast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/utils";
import { ToastAction } from "@/components/ui/toast";

const splitDerKey = (key: string) => {
    const segment0 = key.slice(0, key.length - 30);
    const segment1 = key.slice(key.length - 30);
    return [segment0, segment1];
};

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

export const KeysPage = () => {
    const { toast } = useToast();
    const [dialogOpen, setDialogOpen] = useState(false);

    const {
        data: serverKeys,
        refetch,
        error,
        isError,
        isLoading,
    } = useServerKeys();
    const { mutate: addServerKey } = useAddServerKey();

    const keyDeviceForm = useForm<z.infer<typeof KeyDeviceSchema>>();

    useEffect(() => {
        if (!isError) return;
        toast({
            variant: "destructive",
            title: "Error fetching server keys",
            description: error?.message || "Unknown error.",
            action: (
                <ToastAction
                    altText="Try fetch again"
                    onClick={() => refetch()}
                >
                    Try again
                </ToastAction>
            ),
        });
    }, [isError, error]);

    const onSubmit = async (e?: React.SyntheticEvent) => {
        e?.preventDefault();
        try {
            await addServerKey(keyDeviceForm.getValues().id);
            setDialogOpen(false);
        } catch (error) {
            const message = getErrorMessage(error);
            toast({
                variant: "destructive",
                title: "Error adding server key",
                description: `${message || "Unknown error"}. Please try again.`,
            });
        }
        setTimeout(refetch, 1000);
    };

    const copyKeyAsPEM = async (derHex: string) => {
        try {
            const cryptoKey = await hexDERPublicKeyToCryptoKey(derHex);
            const pemKey = await exportKeyToPEM(cryptoKey, "PUBLIC KEY");
            await copyToClipboard(pemKey);
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

    if (isLoading) {
        return (
            <main className="flex h-[450px] select-none items-center justify-center">
                <Loader2 className="animate-spin" size={64} />
            </main>
        );
    }

    // there was an error and no keys have been fetched
    if (!serverKeys && isError) {
        return (
            <main className="flex select-none justify-center">
                <div className="mt-4 w-full">
                    <EmptyBlock
                        buttonLabel="Try again"
                        onClick={refetch}
                        title="Something went wrong"
                        description={`Server keys could not be fetched. ${
                            error?.message
                                ? `Error: ${error?.message}.`
                                : "Unknown error"
                        }.`}
                        ButtonIcon={CircleAlert}
                    />
                </div>
            </main>
        );
    }

    // fetch was successful and there are no keys
    if (serverKeys && serverKeys.length === 0) {
        return (
            <main className="flex select-none justify-center">
                <div className="mt-4 w-full">
                    <EmptyBlock
                        buttonLabel="New Key"
                        onClick={() => setDialogOpen(true)}
                        title="No server keys"
                        description="There are no keys available to the server for signing."
                        ButtonIcon={FileKey2}
                    />
                </div>
            </main>
        );
    }

    // fetch was successful and there are keys
    return (
        <main className="flex select-none justify-center">
            <div className="space-y-2">
                <div className="flex justify-end">
                    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                        <DialogTrigger asChild>
                            <Button size="sm" variant="outline">
                                <SquarePlus className="mr-2 h-4 w-4" />
                                New key
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px]">
                            <DialogHeader>
                                <DialogTitle>Create a new key</DialogTitle>
                                <DialogDescription>
                                    Which device do you want to generate a key
                                    with?
                                </DialogDescription>
                            </DialogHeader>
                            <KeyDeviceForm
                                form={keyDeviceForm}
                                next={onSubmit}
                                deviceNotFoundErrorMessage="No security devices were found. Please ensure one is available."
                            />
                            <DialogFooter>
                                <Button type="submit" onClick={onSubmit}>
                                    Create key
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
                <div className="rounded-md border">
                    <Table className="table-fixed">
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-32 text-center">
                                    Auth service
                                </TableHead>
                                <TableHead className="w-full">
                                    Public key (hex-encoded DER)
                                </TableHead>
                                <TableHead className="w-16 text-right"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {serverKeys?.map((key) => (
                                <TableRow key={key.rawData}>
                                    <TableCell className="px-4 py-2 text-center font-medium">
                                        {key.service}
                                    </TableCell>
                                    <TableCell className="max-w-0 px-4 py-2">
                                        <div className="flex">
                                            <div className="truncate">
                                                {splitDerKey(key.rawData)[0]}
                                            </div>
                                            <div className="shrink-0">
                                                {splitDerKey(key.rawData)[1]}
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="px-4 py-2 text-right">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                >
                                                    <MoreHorizontal className="h-4 w-4" />
                                                    <span className="sr-only">
                                                        Open menu
                                                    </span>
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem
                                                    onClick={() =>
                                                        copyToClipboard(
                                                            key.rawData
                                                        )
                                                    }
                                                >
                                                    <Copy className="mr-2 h-4 w-4" />
                                                    Copy hex DER
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onClick={() =>
                                                        copyKeyAsPEM(
                                                            key.rawData
                                                        )
                                                    }
                                                >
                                                    <FileKey className="mr-2 h-4 w-4" />
                                                    Copy PEM
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onClick={() =>
                                                        downloadKeyAsPEM(
                                                            key.rawData
                                                        )
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
            </div>
        </main>
    );
};
