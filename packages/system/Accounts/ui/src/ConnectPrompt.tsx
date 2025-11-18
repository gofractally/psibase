import { CircleUserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { getSupervisor, prompt } from "@psibase/common-lib";

import { Avatar } from "@shared/components/avatar";
import { useBranding } from "@shared/hooks/use-branding";
import { Button } from "@shared/shadcn/ui/button";
import {
    CardAction,
    CardContent,
    CardFooter,
    CardTitle,
} from "@shared/shadcn/ui/card";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Input } from "@shared/shadcn/ui/input";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { BrandedGlowingCard } from "./components/branded-glowing-card";

const supervisor = getSupervisor();
const fc = (
    service: string,
    plugin: string,
    intf: string,
    method: string,
    params: unknown[] = [],
) => supervisor.functionCall({ service, plugin, intf, method, params });

const api = {
    getAllAccounts: () => fc("accounts", "plugin", "admin", "getAllAccounts"),
    canCreateAccount: () =>
        fc("accounts", "plugin", "prompt", "canCreateAccount"),
    importExisting: (accountName: string) =>
        fc("accounts", "plugin", "prompt", "importExisting", [accountName]),
    createAccount: (accountName: string) =>
        fc("accounts", "plugin", "prompt", "createAccount", [accountName]),
    connectAccount: (accountName: string) =>
        fc("accounts", "plugin", "prompt", "connectAccount", [accountName]),
};

type Busy = "idle" | "importing" | "creating" | "loggingIn";

export const ConnectPrompt = () => {
    const [searchParams, setSearchParams] = useSearchParams();

    const [accounts, setAccounts] = useState<string[]>([]);
    const [canCreate, setCanCreate] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    console.log("error", error);

    const [showImport, setShowImport] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [showCannotCreate, setShowCannotCreate] = useState(false);
    const [importName, setImportName] = useState("");
    const [createName, setCreateName] = useState("");
    const [busy, setBusy] = useState<Busy>("idle");

    const { data: networkName } = useBranding();

    const load = async () => {
        setError(null);
        try {
            const [acctList, canCreateFlag] = await Promise.all([
                api.getAllAccounts(),
                api.canCreateAccount(),
            ]);
            const list = Array.isArray(acctList) ? (acctList as string[]) : [];
            setAccounts(list);
            setCanCreate(Boolean(canCreateFlag));
        } catch {
            setError("Failed to initialize");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleImport = async () => {
        const name = importName.trim();
        if (!name || busy !== "idle") return;
        setBusy("importing");
        setError(null);
        try {
            await api.importExisting(name);
            await load();
            setShowImport(false);
            setImportName("");
        } catch {
            setError("Import failed");
        } finally {
            setBusy("idle");
        }
    };

    const handleCreate = async () => {
        const name = createName.trim();
        if (!name || busy !== "idle") return;
        setBusy("creating");
        setError(null);
        try {
            const privateKey = await api.createAccount(name);
            console.log("privateKey", privateKey);
            await load();
            setShowCreate(false);
            setCreateName("");
        } catch {
            setError("Account creation failed");
        } finally {
            setBusy("idle");
        }
    };

    const handleLogin = async (accountName: string) => {
        console.log("handleLogin", accountName, busy);
        if (busy !== "idle") return;
        setBusy("loggingIn");
        setError(null);
        try {
            await api.connectAccount(accountName);
            prompt.finished();
        } catch {
            setError("Login failed");
            setBusy("idle");
        }
    };

    const handleImportAndLogin = async (
        e: React.FormEvent<HTMLFormElement>,
    ) => {
        e.preventDefault();
        const name = importName.trim();
        if (!name || busy !== "idle") return;
        setBusy("importing");
        setError(null);
        try {
            await api.importExisting(name);
            await api.connectAccount(name);
            prompt.finished();
        } catch {
            setError("Import and login failed");
        }
        setBusy("idle");
    };

    const isImporting = busy === "importing";
    const isCreating = busy === "creating";
    const isLoggingIn = busy === "loggingIn";

    if (loading) {
        return (
            <BrandedGlowingCard>
                <CardContent className="flex flex-col">
                    <Skeleton className="mb-6 h-8 w-[200px]" />
                    <div className="space-y-2">
                        <Skeleton className="h-4 w-[250px]" />
                        <Skeleton className="h-4 w-[200px]" />
                    </div>
                </CardContent>
            </BrandedGlowingCard>
        );
    }

    if (accounts.length === 0 || searchParams.get("step") === "ADD_ACCOUNT") {
        return (
            <>
                <form onSubmit={handleImportAndLogin}>
                    <BrandedGlowingCard>
                        <CardContent className="flex flex-col">
                            <div className="mb-6 flex-1 space-y-2">
                                <CardTitle className="text-3xl font-normal">
                                    Sign in
                                </CardTitle>
                                <div className="text-muted-foreground">
                                    Use your {networkName} account
                                </div>
                            </div>
                            <div className="flex-1">
                                <Input
                                    className="text-foreground placeholder:text-muted-foreground flex-1"
                                    placeholder="Account name"
                                    value={importName}
                                    onChange={(e) =>
                                        setImportName(e.target.value)
                                    }
                                />
                            </div>
                        </CardContent>
                        <CardFooter className="mt-4 flex flex-1 justify-between">
                            <CardAction>
                                <Button
                                    type="button"
                                    variant="link"
                                    onClick={async () => {
                                        if (canCreate) {
                                            setShowCreate(true);
                                        } else {
                                            setShowCannotCreate(true);
                                        }
                                    }}
                                    disabled={isLoggingIn}
                                    className="px-0 focus-visible:underline focus-visible:underline-offset-4 focus-visible:ring-0"
                                >
                                    Create account
                                </Button>
                            </CardAction>
                            <CardAction>
                                <Button
                                    type="submit"
                                    disabled={!importName.trim() || isImporting}
                                >
                                    {isImporting ? "Importing…" : "Import"}
                                </Button>
                            </CardAction>
                        </CardFooter>
                    </BrandedGlowingCard>
                </form>

                <Dialog
                    open={showCreate}
                    onOpenChange={(open) => !open && setShowCreate(false)}
                >
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create new account</DialogTitle>
                        </DialogHeader>
                        <div className="flex items-center gap-2">
                            <Input
                                className="text-foreground placeholder:text-muted-foreground flex-1"
                                placeholder="Enter account name"
                                value={createName}
                                onChange={(e) => setCreateName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") handleCreate();
                                }}
                            />
                            <Button
                                onClick={handleCreate}
                                disabled={!createName.trim() || isCreating}
                            >
                                {isCreating ? "Creating…" : "Create"}
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>

                <Dialog
                    open={showCannotCreate}
                    onOpenChange={(open) => !open && setShowCannotCreate(false)}
                >
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Cannot create account</DialogTitle>
                        </DialogHeader>
                        <DialogDescription>
                            To create an account, you must either be logged in
                            as an existing account or have an active invite.
                        </DialogDescription>
                        <DialogFooter>
                            <DialogClose asChild>
                                <Button>Okay</Button>
                            </DialogClose>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </>
        );
    }

    return (
        <BrandedGlowingCard>
            <CardContent className="flex flex-1 flex-col">
                <CardTitle className="mb-6 text-3xl font-normal">
                    Choose an account
                </CardTitle>
                <div className="space-y-3">
                    <ul>
                        {accounts.map((name) => {
                            return (
                                <div key={`account-${name}`}>
                                    <li
                                        onClick={() => handleLogin(name)}
                                        className="hover:bg-sidebar-accent flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-4"
                                    >
                                        <Avatar
                                            account={name}
                                            className="size-6"
                                        />
                                        <div>{name}</div>
                                    </li>
                                    <div className="bg-border mx-2 h-px" />
                                </div>
                            );
                        })}
                        <li
                            key="account-use-another"
                            className="hover:bg-sidebar-accent flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-4"
                            onClick={() => {
                                setSearchParams({ step: "ADD_ACCOUNT" });
                            }}
                        >
                            <div className="flex size-6 items-center justify-center">
                                <CircleUserRound className="text-muted-foreground size-5" />
                            </div>
                            <div>Use another account</div>
                        </li>
                    </ul>
                </div>
            </CardContent>
        </BrandedGlowingCard>
    );

    return (
        <Dialog
            open={showImport}
            onOpenChange={(open) => !open && setShowImport(false)}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Import existing account</DialogTitle>
                </DialogHeader>
                <div className="flex items-center gap-2">
                    <Input
                        className="text-foreground placeholder:text-muted-foreground flex-1"
                        placeholder="Enter account name"
                        value={importName}
                        onChange={(e) => setImportName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleImport();
                        }}
                    />
                    <Button
                        onClick={handleImport}
                        disabled={!importName.trim() || isImporting}
                    >
                        {isImporting ? "Importing…" : "Import"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};
