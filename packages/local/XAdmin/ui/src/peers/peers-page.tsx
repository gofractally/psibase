import { Clipboard, MoreHorizontal, Plus, Trash, Unplug } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useToast } from "@/components/ui/use-toast";

import { SmartConnectForm } from "@/components/forms/smart-connect-form";
import { PageHeading } from "@/components/page-heading";
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
import { RadioGroup, RadioGroupItem } from "@shared/shadcn/ui/radio-group";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@shared/shadcn/ui/tabs";

import { useConfig, useConfigUpdate } from "../hooks/use-config";
import { usePeerUsers, useSetPeerUser } from "../hooks/use-peer-users";
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
                                Allow an on-chain account to open an incoming
                                P2P connection to this node.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-2 py-4">
                            <Label htmlFor="peer-user-account">
                                Account name
                            </Label>
                            <Input
                                id="peer-user-account"
                                autoComplete="off"
                                placeholder="Account name"
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
                            <Button type="submit" disabled={isUpdatingPeerUser}>
                                Add
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <PageHeading
                title="Peers"
                description="Manage connections to other nodes."
            />
            <Tabs defaultValue="connections">
                <TabsList>
                    <TabsTrigger value="connections">Connections</TabsTrigger>
                    <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
                <TabsContent value="connections">
                    <div className="flex items-center justify-end py-2">
                        {combinedPeers.length !== 0 && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setShowModalConnection(true)}
                            >
                                <Plus />
                                Add connection
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
                                    <TableHead className="w-12">
                                        <span className="sr-only">Actions</span>
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {combinedPeers.map((peer) => (
                                    <TableRow key={peer.id}>
                                        <TableCell>
                                            <span
                                                className={cn({
                                                    italic: !peer.url,
                                                })}
                                            >
                                                {peer.url ?? "Unknown"}
                                            </span>
                                        </TableCell>
                                        <TableCell>{peer.endpoint}</TableCell>
                                        <TableCell>
                                            <Status state={peer.state} />
                                        </TableCell>
                                        <TableCell>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                    >
                                                        <span className="sr-only">
                                                            Open menu
                                                        </span>
                                                        <MoreHorizontal />
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
                                                    {peer.state ==
                                                        "transient" && (
                                                        <DropdownMenuItem
                                                            onClick={() =>
                                                                disconnectPeer(
                                                                    peer.id,
                                                                )
                                                            }
                                                        >
                                                            <Unplug className="mr-2 h-4 w-4" />
                                                            <span>
                                                                Disconnect
                                                            </span>
                                                        </DropdownMenuItem>
                                                    )}
                                                    {peer.state !==
                                                        "transient" && (
                                                        <DropdownMenuItem
                                                            onClick={() =>
                                                                removePeer(
                                                                    peer.id,
                                                                )
                                                            }
                                                        >
                                                            <Trash className="mr-2 h-4 w-4" />
                                                            <span>Remove</span>
                                                        </DropdownMenuItem>
                                                    )}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                    {configPeersError && <div>{configPeersError}</div>}
                </TabsContent>
                <TabsContent value="settings">
                    <div className="py-2">
                        <h3 className="text-lg font-semibold tracking-tight">
                            Incoming connection policy
                        </h3>
                        <p className="text-muted-foreground text-sm">
                            Choose who may open a P2P connection to this node.
                        </p>
                    </div>
                    <RadioGroup
                        className="mb-6 mt-3 gap-3"
                        value={p2pEnabled ? "all" : "whitelist"}
                        disabled={isUpdatingConfig || config === undefined}
                        onValueChange={(value) => onP2pChange(value === "all")}
                    >
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="all" id="p2p-all" />
                            <Label htmlFor="p2p-all">
                                Accept all incoming P2P connections
                            </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem
                                value="whitelist"
                                id="p2p-whitelist"
                            />
                            <Label htmlFor="p2p-whitelist">
                                Accept incoming P2P connections from whitelisted
                                accounts only
                            </Label>
                        </div>
                    </RadioGroup>

                    {!p2pEnabled && (
                        <div>
                            <div className="flex items-center justify-between py-2">
                                <div>
                                    <h3 className="text-lg font-semibold tracking-tight">
                                        Allowed peers whitelist
                                    </h3>
                                    <p className="text-muted-foreground text-sm">
                                        On-chain accounts allowed to open an
                                        incoming P2P connection to this node.
                                    </p>
                                </div>
                                {peerUsers.length !== 0 && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setShowAddPeerUser(true)}
                                    >
                                        <Plus />
                                        Add
                                    </Button>
                                )}
                            </div>
                            {peerUsers.length === 0 ? (
                                <EmptyBlock
                                    buttonLabel="Add allowed peer"
                                    onButtonClick={() =>
                                        setShowAddPeerUser(true)
                                    }
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
                                                <TableCell>{account}</TableCell>
                                                <TableCell>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        disabled={
                                                            isUpdatingPeerUser
                                                        }
                                                        onClick={() =>
                                                            onRemovePeerUser(
                                                                account,
                                                            )
                                                        }
                                                    >
                                                        <span className="sr-only">
                                                            Remove {account}
                                                        </span>
                                                        <Trash />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </>
    );
};
