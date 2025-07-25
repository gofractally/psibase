import { Clipboard, MoreHorizontal, Plus, Trash, Unplug } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { useToast } from "@/components/ui/use-toast";

import { EmptyBlock } from "@/components/EmptyBlock";
import { Pulse } from "@/components/Pulse";
import { SmartConnectForm } from "@/components/forms/smart-connect-form";

import {
    PeerType,
    PeersType,
    StateEnum,
    UIPeer,
    chain,
} from "@/lib/chainEndpoints";

import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@shared/shadcn/ui/dropdown-menu";
import {
    Table,
    TableBody,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

import { useConfig } from "../hooks/useConfig";
import { usePeers } from "../hooks/usePeers";

const randomIntFromInterval = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1) + min);

const combinePeers = (
    configPeers: string[],
    livePeers: PeersType,
): z.infer<typeof UIPeer>[] => {
    const configSet = new Set<string>();
    configPeers.forEach((peer) => configSet.add(peer));

    const connectMap: { [index: string]: PeerType } = {};
    for (const peer of livePeers) {
        if (peer.url) {
            connectMap[peer.url] = peer;
        }
    }

    const persistentPeers = configPeers.map((url): z.infer<typeof UIPeer> => {
        if (url in connectMap) {
            return {
                state: "persistent",
                url: url,
                ...connectMap[url],
            };
        } else {
            return {
                state: "backup",
                url: url,
                endpoint: "",
                id: randomIntFromInterval(200, 2000) * -1,
            };
        }
    });

    const transientPeers: z.infer<typeof UIPeer>[] = livePeers
        .filter((peer) => !peer.url || !configSet.has(peer.url))
        .map(
            (peer): z.infer<typeof UIPeer> => ({
                state: "transient",
                url: peer.url ?? "",
                ...peer,
            }),
        );

    return UIPeer.array().parse([...persistentPeers, ...transientPeers]);
};

const Status = ({ state }: { state: z.infer<typeof StateEnum> }) => {
    const color =
        state == "persistent"
            ? "green"
            : state == "transient"
              ? "yellow"
              : "red";

    const label =
        state == "persistent"
            ? "Online"
            : state == "transient"
              ? "Transient"
              : "Disconnected";
    return (
        <div className="flex gap-1">
            <div className="my-auto">
                <Pulse color={color} />
            </div>
            <span>{label}</span>
        </div>
    );
};

export const PeersPage = () => {
    const { data: livePeers, refetch: refetchPeers } = usePeers();
    const { data: config, refetch: refetchConfig } = useConfig();
    const configPeers = config?.peers || [];

    const combinedPeers = combinePeers(configPeers, livePeers);

    const [configPeersError] = useState<string>();
    const { toast } = useToast();

    const [showAddModalConnection, setShowModalConnection] = useState(false);

    const onConnection = async () => {
        setShowModalConnection(false);
        refetchConfig();
    };

    const disconnectPeer = async (id: number) => {
        await chain.disconnectPeer(id);
        refetchPeers();
    };

    const removePeer = async (id: number) => {
        const peer = combinedPeers.find((peer) => peer.id == id);
        if (!peer) {
            throw new Error("Failed to find the peer locally");
        }

        if (peer.state == "transient") {
            throw new Error(
                "Only disconnections from transient connections are possible.",
            );
        } else if (peer.state == "backup") {
            await chain.removePeer(peer.url!);
            refetchConfig();
            toast({
                title: "Error",
                description: "Failed to remove peer",
            });
        } else if (peer.state == "persistent") {
            try {
                await Promise.all([
                    chain.removePeer(peer.url!),
                    chain.disconnectPeer(peer.id),
                ]);
                refetchConfig();
            } catch {
                toast({
                    title: "Error",
                    description: "Failed to disconnect & remove peer",
                });
            }
        }
    };

    return (
        <>
            <Dialog
                open={showAddModalConnection}
                onOpenChange={(show) => {
                    setShowModalConnection(show);
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add connection</DialogTitle>
                        <DialogDescription>
                            <SmartConnectForm onConnection={onConnection} />
                        </DialogDescription>
                    </DialogHeader>
                </DialogContent>
            </Dialog>

            <div className="flex justify-between py-2">
                <div></div>
                {combinedPeers.length !== 0 && (
                    <div>
                        <Button
                            variant="outline"
                            onClick={() => setShowModalConnection(true)}
                        >
                            <Plus size={20} />
                        </Button>
                    </div>
                )}
            </div>
            {combinedPeers.length == 0 ? (
                <EmptyBlock
                    buttonLabel="Add Connection"
                    onClick={() => setShowModalConnection(true)}
                    title="No connections"
                    description="No existing connections to other nodes."
                />
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>URL</TableHead>
                            <TableHead>Address</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Status</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {combinedPeers.map((peer) => (
                            <TableRow key={peer.id}>
                                <TableHead>
                                    <span className={cn({ italic: !peer.url })}>
                                        {peer.url ?? "Unknown"}
                                    </span>
                                </TableHead>
                                <TableHead>{peer.endpoint}</TableHead>
                                <TableHead>
                                    <Status state={peer.state} />
                                </TableHead>
                                <TableHead>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                className="my-auto h-full w-8 p-0"
                                            >
                                                <span className="sr-only">
                                                    Open menu
                                                </span>
                                                <MoreHorizontal className="h-8 w-8" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuLabel>
                                                Actions
                                            </DropdownMenuLabel>
                                            <DropdownMenuItem
                                                onClick={() => {
                                                    navigator.clipboard.writeText(
                                                        peer.url ||
                                                            peer.endpoint,
                                                    );
                                                }}
                                            >
                                                <Clipboard className="mr-2 h-4 w-4" />
                                                <span>Copy URL</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            {peer.state == "transient" && (
                                                <DropdownMenuItem
                                                    onClick={() =>
                                                        disconnectPeer(peer.id)
                                                    }
                                                >
                                                    <Unplug className="mr-2 h-4 w-4" />
                                                    <span>Disconnect</span>
                                                </DropdownMenuItem>
                                            )}
                                            {peer.state !== "transient" && (
                                                <DropdownMenuItem
                                                    onClick={() =>
                                                        removePeer(peer.id)
                                                    }
                                                >
                                                    <Trash className="mr-2 h-4 w-4" />
                                                    <span>Remove</span>
                                                </DropdownMenuItem>
                                            )}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </TableHead>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
            {configPeersError && <div>{configPeersError}</div>}
        </>
    );
};
