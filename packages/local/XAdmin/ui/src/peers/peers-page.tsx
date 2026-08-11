import {
    Clipboard,
    Info,
    MoreHorizontal,
    Plus,
    Trash,
    Unplug,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useToast } from "@/components/ui/use-toast";

import { SmartConnectForm } from "@/components/forms/smart-connect-form";
import { Pulse } from "@/components/pulse";

import {
    PeerType,
    PeersType,
    StateEnum,
    UIPeer,
    chain,
} from "@/lib/chain-endpoints";

import { EmptyBlock } from "@shared/components/empty-block";
import { zAccount } from "@shared/lib/schemas/account";
import { cn } from "@shared/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@shared/shadcn/ui/alert";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
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
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Switch } from "@shared/shadcn/ui/switch";
import {
    Table,
    TableBody,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

import { useConfig, useConfigUpdate } from "../hooks/use-config";
import {
    usePeerUsers,
    useSetPeerUser,
} from "../hooks/use-peer-users";
import { usePeers } from "../hooks/use-peers";

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
        for (const url of peer.urls) {
            connectMap[url] = peer;
        }
    }

    const persistentPeers = configPeers.map((url): z.infer<typeof UIPeer> => {
        if (url in connectMap) {
            const { id, endpoint } = connectMap[url];
            return {
                state: "persistent",
                url: url,
                id,
                endpoint,
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
        .filter((peer) => !peer.urls.some((url) => configSet.has(url)))
        .map(
            (peer): z.infer<typeof UIPeer> => ({
                state: "transient",
                url: peer.urls[0] ?? "",
                id: peer.id,
                endpoint: peer.endpoint,
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

const PeerUserFormSchema = z.object({
    account: zAccount,
});

type PeerUserForm = z.infer<typeof PeerUserFormSchema>;

export const PeersPage = () => {
    const { data: livePeers, refetch: refetchPeers } = usePeers();
    const { data: config, refetch: refetchConfig } = useConfig();
    const { mutate: updateConfig, isPending: isUpdatingConfig } =
        useConfigUpdate();
    const { data: peerUsers } = usePeerUsers();
    const { mutateAsync: setPeerUser, isPending: isUpdatingPeerUser } =
        useSetPeerUser();
    const configPeers = config?.peers || [];
    const p2pEnabled = config?.p2p ?? false;

    const combinedPeers = combinePeers(configPeers, livePeers);

    const [configPeersError] = useState<string>();
    const { toast } = useToast();

    const [showAddModalConnection, setShowModalConnection] = useState(false);
    const [showAddPeerUser, setShowAddPeerUser] = useState(false);
    const peerUserForm = useForm<PeerUserForm>({
        defaultValues: { account: "" },
    });

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

    const onP2pChange = (checked: boolean) => {
        updateConfig(
            { p2p: checked },
            {
                onError: () => {
                    toast({
                        title: "Error",
                        description: "Failed to update P2P setting",
                    });
                },
            },
        );
    };

    const onAddPeerUser = async (values: PeerUserForm) => {
        const parsed = PeerUserFormSchema.safeParse(values);
        if (!parsed.success) {
            const message =
                parsed.error.issues[0]?.message ?? "Invalid account name";
            peerUserForm.setError("account", { message });
            return;
        }

        try {
            await setPeerUser({ account: parsed.data.account, accept: true });
            setShowAddPeerUser(false);
            peerUserForm.reset({ account: "" });
            toast({
                title: "Allowed peer added",
                description: `${parsed.data.account} can now peer with this node.`,
            });
        } catch {
            toast({
                title: "Error",
                description: "Failed to add allowed peer",
            });
        }
    };

    const onRemovePeerUser = async (account: string) => {
        try {
            await setPeerUser({ account, accept: false });
            toast({
                title: "Allowed peer removed",
                description: `${account} can no longer peer with this node.`,
            });
        } catch {
            toast({
                title: "Error",
                description: "Failed to remove allowed peer",
            });
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

            <Dialog
                open={showAddPeerUser}
                onOpenChange={(show) => {
                    setShowAddPeerUser(show);
                    if (!show) {
                        peerUserForm.reset({ account: "" });
                    }
                }}
            >
                <DialogContent>
                    <form onSubmit={peerUserForm.handleSubmit(onAddPeerUser)}>
                        <DialogHeader>
                            <DialogTitle>Add allowed peer</DialogTitle>
                            <DialogDescription>
                                Allow an on-chain account to peer with this
                                node when open P2P is disabled.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-2 py-4">
                            <Label htmlFor="peer-user-account">Account</Label>
                            <Input
                                id="peer-user-account"
                                autoComplete="off"
                                placeholder="account-name"
                                {...peerUserForm.register("account")}
                            />
                            {peerUserForm.formState.errors.account && (
                                <p className="text-destructive text-sm">
                                    {
                                        peerUserForm.formState.errors.account
                                            .message
                                    }
                                </p>
                            )}
                        </div>
                        <DialogFooter>
                            <Button
                                type="submit"
                                disabled={isUpdatingPeerUser}
                            >
                                Add
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <div className="my-6 flex items-center space-x-2">
                <Switch
                    checked={p2pEnabled}
                    disabled={isUpdatingConfig || config === undefined}
                    onCheckedChange={onP2pChange}
                />
                <Label>Accept all incoming P2P connections</Label>
            </div>

            <div className="flex items-center justify-between py-2">
                <h3 className="text-lg font-semibold tracking-tight">
                    Connections
                </h3>
                {combinedPeers.length !== 0 && (
                    <Button
                        variant="outline"
                        onClick={() => setShowModalConnection(true)}
                    >
                        <Plus size={20} />
                    </Button>
                )}
            </div>
            {combinedPeers.length == 0 ? (
                <EmptyBlock
                    buttonLabel="Add Connection"
                    onButtonClick={() => setShowModalConnection(true)}
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

            <div className="relative mt-10">
                <div
                    className={cn(
                        "transition-all",
                        p2pEnabled &&
                            "pointer-events-none select-none opacity-40 blur-[1px]",
                    )}
                >
                    <div className="flex items-center justify-between py-2">
                        <div>
                            <h3 className="text-lg font-semibold tracking-tight">
                                Allowed peers
                            </h3>
                            <p className="text-muted-foreground text-sm">
                                Accounts allowed to peer with this node when
                                open P2P is disabled.
                            </p>
                        </div>
                        {peerUsers.length !== 0 && (
                            <Button
                                variant="outline"
                                onClick={() => setShowAddPeerUser(true)}
                            >
                                <Plus size={20} />
                            </Button>
                        )}
                    </div>
                    {peerUsers.length === 0 ? (
                        <EmptyBlock
                            buttonLabel="Add allowed peer"
                            onButtonClick={() => setShowAddPeerUser(true)}
                            title="No allowed peers"
                            description="Add an account to allow it to peer with this node."
                        />
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Account</TableHead>
                                    <TableHead className="w-12" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {peerUsers.map((account) => (
                                    <TableRow key={account}>
                                        <TableHead>{account}</TableHead>
                                        <TableHead>
                                            <Button
                                                variant="ghost"
                                                className="h-8 w-8 p-0"
                                                disabled={isUpdatingPeerUser}
                                                onClick={() =>
                                                    onRemovePeerUser(account)
                                                }
                                            >
                                                <span className="sr-only">
                                                    Remove {account}
                                                </span>
                                                <Trash className="h-4 w-4" />
                                            </Button>
                                        </TableHead>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </div>

                {p2pEnabled && (
                    <div className="absolute inset-0 flex items-center justify-center p-4">
                        <Alert className="bg-background max-w-md shadow-sm">
                            <Info />
                            <AlertTitle>Whitelist disabled</AlertTitle>
                            <AlertDescription>
                                Open P2P is accepting all incoming peers. Turn
                                off &quot;Accept all incoming P2P connections&quot;
                                above to use the allowed-peers whitelist.
                            </AlertDescription>
                        </Alert>
                    </div>
                )}
            </div>
        </>
    );
};
