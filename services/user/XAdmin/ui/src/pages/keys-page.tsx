import { useEffect, useState } from "react";
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
    Lock,
    Unlock,
} from "lucide-react";

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
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/components/ui/use-toast";
import { Tabs } from "@/components/ui/tabs";
import { TabsList } from "@/components/ui/tabs";
import { TabsTrigger } from "@/components/ui/tabs";
import { TabsContent } from "@/components/ui/tabs";

import { EmptyBlock } from "@/components/EmptyBlock";
import { KeyDeviceForm } from "@/components/forms/key-device-form";
import { KeyDeviceSchema } from "@/types";
import { hexDERPublicKeyToCryptoKey, exportKeyToPEM } from "@/lib/keys";
import { getErrorMessage } from "@/lib/utils";

import {
    useServerKeys,
    useAddServerKey,
    useKeyDevices,
} from "../hooks/useKeyDevices";

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
    const [newKeyDialogOpen, setNewKeyDialogOpen] = useState(false);
    const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);

    const {
        data: serverKeys,
        isLoading: isLoadingServerKeys,
        error: errorFetchingServerKeys,
        isError: isErrorFetchingServerKeys,
        refetch: refetchServerKeys,
    } = useServerKeys();
    const { mutate: addServerKey } = useAddServerKey();

    const {
        data: keyDevices,
        isLoading: isKeyDevicesLoading,
        error: errorFetchingKeyDevices,
        isError: isErrorFetchingKeyDevices,
        refetch: refetchKeyDevices,
    } = useKeyDevices();
    const hasKeyDevices = keyDevices && keyDevices.length > 0;

    const keyDeviceForm = useForm<z.infer<typeof KeyDeviceSchema>>();

    useEffect(() => {
        if (!isErrorFetchingServerKeys) return;
        toast({
            variant: "destructive",
            title: "Error fetching server keys",
            description: errorFetchingServerKeys?.message || "Unknown error.",
            action: (
                <ToastAction
                    altText="Try fetch again"
                    onClick={() => refetchServerKeys()}
                >
                    Try again
                </ToastAction>
            ),
        });
    }, [isErrorFetchingServerKeys, errorFetchingServerKeys]);

    const onSubmit = async (
        e?: React.SyntheticEvent,
        shouldCreateKey: boolean = false
    ) => {
        e?.preventDefault();
        try {
            const isPassable = await keyDeviceForm.trigger();
            if (!isPassable) return;

            if (shouldCreateKey) {
                await addServerKey(keyDeviceForm.getValues().id);
                toast({
                    title: "Added",
                    description: "The key has been added to the server.",
                });
            } else {
                toast({
                    title: "Unlocked",
                    description: "The security device has been unlocked.",
                });
            }
            setNewKeyDialogOpen(false);
            setUnlockDialogOpen(false);
        } catch (error) {
            const message = getErrorMessage(error);
            toast({
                variant: "destructive",
                title: "Error adding server key",
                description: `${message || "Unknown error"}. Please try again.`,
            });
        }

        setTimeout(() => {
            refetchServerKeys();
            refetchKeyDevices();
        }, 1000);
    };

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

    if (isLoadingServerKeys || isKeyDevicesLoading) {
        return (
            <main className="flex h-[450px] select-none items-center justify-center">
                <Loader2 className="animate-spin" size={64} />
            </main>
        );
    }

    // there was an error and no security devices have been fetched
    if (!keyDevices && isErrorFetchingKeyDevices) {
        return (
            <main className="flex select-none justify-center">
                <div className="mt-4 w-full">
                    <EmptyBlock
                        buttonLabel="Try again"
                        onClick={() => {
                            refetchServerKeys();
                            refetchKeyDevices();
                        }}
                        title="Something went wrong"
                        description={`Security devices could not be fetched. ${
                            errorFetchingKeyDevices?.message
                                ? `Error: ${errorFetchingKeyDevices?.message}.`
                                : "Unknown error"
                        }.`}
                        ButtonIcon={CircleAlert}
                    />
                </div>
            </main>
        );
    }

    // there are no key devices configured for the chain
    if (!hasKeyDevices) {
        return (
            <main className="flex select-none justify-center">
                <div className="mt-4 w-full">
                    <EmptyBlock
                        title="No security devices"
                        description="No security devices were found for storing server keys. Please ensure one is available."
                        ButtonIcon={CircleAlert}
                    />
                </div>
            </main>
        );
    }

    // there was an error and no keys have been fetched
    if (!serverKeys && isErrorFetchingServerKeys) {
        return (
            <main className="flex select-none justify-center">
                <div className="mt-4 w-full">
                    <EmptyBlock
                        buttonLabel="Try again"
                        onClick={() => {
                            refetchServerKeys();
                            refetchKeyDevices();
                        }}
                        title="Something went wrong"
                        description={`Server keys could not be fetched. ${
                            errorFetchingServerKeys?.message
                                ? `Error: ${errorFetchingServerKeys?.message}.`
                                : "Unknown error"
                        }.`}
                        ButtonIcon={CircleAlert}
                    />
                </div>
            </main>
        );
    }

    return (
        <main className="flex select-none justify-center">
            <div className="w-full space-y-2">
                <Tabs defaultValue="devices" className="">
                    <div className="flex justify-between">
                        <TabsList>
                            <TabsTrigger value="devices">Devices</TabsTrigger>
                            <TabsTrigger value="keys">Keys</TabsTrigger>
                        </TabsList>
                        <div className="flex gap-2">
                            <Dialog
                                open={unlockDialogOpen}
                                onOpenChange={setUnlockDialogOpen}
                            >
                                <DialogTrigger asChild>
                                    <Button size="sm" variant="outline">
                                        <Unlock className="mr-2 h-4 w-4" />
                                        Unlock a device
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle>
                                            Unlock a security device
                                        </DialogTitle>
                                        <DialogDescription>
                                            Which device do you want to unlock?
                                        </DialogDescription>
                                    </DialogHeader>
                                    <KeyDeviceForm
                                        form={keyDeviceForm}
                                        next={() => onSubmit()}
                                        deviceNotFoundErrorMessage="No security devices were found. Please ensure one is available."
                                    />
                                    <DialogFooter>
                                        <Button
                                            type="submit"
                                            onClick={onSubmit}
                                        >
                                            Unlock
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                            <Dialog
                                open={newKeyDialogOpen}
                                onOpenChange={setNewKeyDialogOpen}
                            >
                                <DialogTrigger asChild>
                                    <Button size="sm" variant="outline">
                                        <SquarePlus className="mr-2 h-4 w-4" />
                                        New key
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle>
                                            Create a new key
                                        </DialogTitle>
                                        <DialogDescription>
                                            Which device do you want to generate
                                            a key with?
                                        </DialogDescription>
                                    </DialogHeader>
                                    <KeyDeviceForm
                                        form={keyDeviceForm}
                                        next={() => onSubmit(undefined, true)}
                                        deviceNotFoundErrorMessage="No security devices were found. Please ensure one is available."
                                    />
                                    <DialogFooter>
                                        <Button
                                            type="submit"
                                            onClick={(e) => onSubmit(e, true)}
                                        >
                                            Create key
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </div>
                    <TabsContent value="devices">
                        <div className="rounded-md border">
                            <Table className="table-fixed">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-48 text-center">
                                            Device name
                                        </TableHead>
                                        <TableHead className="w-full">
                                            Device ID
                                        </TableHead>
                                        <TableHead className="w-24 text-center">
                                            Status
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {keyDevices?.map((device) => (
                                        <TableRow key={device.id}>
                                            <TableCell className="px-4 py-2 text-center font-medium">
                                                {device.name}
                                            </TableCell>
                                            <TableCell className="max-w-0 px-4 py-2">
                                                {device.id}
                                            </TableCell>
                                            <TableCell className="mt-0.5 flex items-center justify-center px-4 py-2">
                                                {device.unlocked ? (
                                                    <Unlock className="h-4 w-4" />
                                                ) : (
                                                    <Lock
                                                        className="h-4 w-4"
                                                        color="red"
                                                    />
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </TabsContent>
                    <TabsContent value="keys">
                        {serverKeys && serverKeys?.length === 0 ? (
                            <div className="mt-4 w-full">
                                <EmptyBlock
                                    buttonLabel={
                                        keyDevices.every((kd) => !kd.unlocked)
                                            ? undefined
                                            : "New Key"
                                    }
                                    onClick={() => setNewKeyDialogOpen(true)}
                                    title="No server keys available"
                                    description={
                                        keyDevices.every((kd) => !kd.unlocked)
                                            ? "No server keys are available. Unlock a device to view keys in that device or create a new key to continue."
                                            : "There are no server keys available to the server for signing."
                                    }
                                    ButtonIcon={FileKey2}
                                />
                            </div>
                        ) : (
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
                                                            {
                                                                splitDerKey(
                                                                    key.rawData
                                                                )[0]
                                                            }
                                                        </div>
                                                        <div className="shrink-0">
                                                            {
                                                                splitDerKey(
                                                                    key.rawData
                                                                )[1]
                                                            }
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="px-4 py-2 text-right">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger
                                                            asChild
                                                        >
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
                                                                onClick={() => {
                                                                    copyToClipboard(
                                                                        key.rawData
                                                                    );
                                                                    toast({
                                                                        title: "Copied",
                                                                        description:
                                                                            "The key has been copied to the clipboard.",
                                                                    });
                                                                }}
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
                        )}
                    </TabsContent>
                </Tabs>
            </div>
        </main>
    );
};
