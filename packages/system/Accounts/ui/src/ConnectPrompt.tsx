import { useEffect, useState } from "react";

import { getSupervisor, prompt } from "@psibase/common-lib";

import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";

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
    const [accounts, setAccounts] = useState<string[]>([]);
    const [selectedAccount, setSelectedAccount] = useState("");
    const [canCreate, setCanCreate] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [showImport, setShowImport] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [importName, setImportName] = useState("");
    const [createName, setCreateName] = useState("");
    const [busy, setBusy] = useState<Busy>("idle");

    const selectDefault = (list: string[], current: string) =>
        list.includes(current) ? current : (list[0] ?? "");

    const load = async () => {
        setError(null);
        try {
            const [acctList, canCreateFlag] = await Promise.all([
                api.getAllAccounts(),
                api.canCreateAccount(),
            ]);
            const list = Array.isArray(acctList) ? (acctList as string[]) : [];
            setAccounts(list);
            setSelectedAccount((prev) => selectDefault(list, prev));
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
            setSelectedAccount(name);
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
            /* const privateKey = */ await api.createAccount(name);
            await load();
            setSelectedAccount(name);
            setShowCreate(false);
            setCreateName("");
        } catch {
            setError("Account creation failed");
        } finally {
            setBusy("idle");
        }
    };

    const handleLogin = async () => {
        if (!selectedAccount || busy !== "idle") return;
        setBusy("loggingIn");
        setError(null);
        try {
            await api.connectAccount(selectedAccount);
            prompt.finished();
        } catch {
            setError("Login failed");
            setBusy("idle");
        }
    };

    const isImporting = busy === "importing";
    const isCreating = busy === "creating";
    const isLoggingIn = busy === "loggingIn";

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-md p-6">
            <Card>
                <CardHeader>
                    <CardTitle className="text-3xl">
                        Connect an account
                    </CardTitle>
                    {error && (
                        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded border p-2">
                            {error}
                        </div>
                    )}
                </CardHeader>
                <CardContent className="space-y-6">
                    {loading ? (
                        <div className="text-muted-foreground">Loading…</div>
                    ) : (
                        <div className="space-y-3">
                            <Label className="mb-2 block">
                                Available accounts
                            </Label>
                            {accounts.length > 0 ? (
                                <Select
                                    value={selectedAccount}
                                    onValueChange={setSelectedAccount}
                                >
                                    <SelectTrigger className="text-foreground">
                                        <SelectValue placeholder="Choose an account" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {accounts.map((name) => (
                                            <SelectItem key={name} value={name}>
                                                {name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <div className="text-muted-foreground text-sm">
                                    No accounts yet.
                                </div>
                            )}

                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setShowImport(true)}
                                    disabled={isLoggingIn}
                                >
                                    Import existing
                                </Button>
                                {canCreate && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => setShowCreate(true)}
                                        disabled={isLoggingIn}
                                    >
                                        Create account
                                    </Button>
                                )}
                            </div>

                            <div className="mt-3">
                                <Button
                                    onClick={handleLogin}
                                    disabled={!selectedAccount || isLoggingIn}
                                >
                                    {isLoggingIn ? "Logging in…" : "Login"}
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

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
        </div>
    );
};
