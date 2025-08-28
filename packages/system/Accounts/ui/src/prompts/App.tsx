import { Plus } from "lucide-react";
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
import { Skeleton } from "@shared/shadcn/ui/skeleton";

const supervisor = getSupervisor();
const fc = (intf: string, method: string, params: unknown[] = []) =>
    supervisor.functionCall({ service: "accounts", intf, method, params });

export const App = () => {
    const [accounts, setAccounts] = useState<string[]>([]);
    const [selectedAccount, setSelectedAccount] = useState<string>("");
    const [newAccount, setNewAccount] = useState<string>("");
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isImporting, setIsImporting] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const [activeApp, setActiveApp] = useState<string>("");
    const [showImport, setShowImport] = useState<boolean>(false);
    const [initialLoading, setInitialLoading] = useState<boolean>(true);

    const loadAccounts = async () =>
        fc("admin", "getAllAccounts")
            .then((r) => {
                const list = Array.isArray(r) ? (r as string[]) : [];
                setAccounts(list);
                setSelectedAccount((prev) =>
                    list.includes(prev) ? prev : (list[0] ?? ""),
                );
            })
            .catch(() => setError("Failed to load accounts"));

    const loadActiveApp = async () =>
        supervisor
            .functionCall({
                service: "host",
                plugin: "common",
                intf: "client",
                method: "getActiveApp",
                params: [],
            })
            .then((r) => setActiveApp(String(r || "")))
            .catch(() => setActiveApp(""));

    useEffect(() => {
        Promise.all([loadAccounts(), loadActiveApp()]).finally(() =>
            setInitialLoading(false),
        );
    }, []);

    const importExisting = async () => {
        const acct = newAccount.trim();
        if (!acct) return;
        setIsImporting(true);
        setError(null);
        try {
            await fc("prompt", "importExisting", [acct]);
            await loadAccounts();
            setSelectedAccount(acct);
            setNewAccount("");
        } catch {
            setError("Import failed");
        } finally {
            setIsImporting(false);
            setShowImport(false);
        }
    };

    const login = async () => {
        if (!selectedAccount) return;
        setIsLoading(true);
        setError(null);
        try {
            await fc("prompt", "connectAccount", [selectedAccount]);
            prompt.finished();
        } catch {
            setError("Login failed");
            setIsLoading(false);
        }
    };

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-md p-6">
            <Card>
                <CardHeader>
                    <CardTitle className="text-3xl">
                        {activeApp
                            ? `Connect to ${activeApp}`
                            : "Connect an account"}
                    </CardTitle>
                    {error && (
                        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded border p-2">
                            {error}
                        </div>
                    )}
                </CardHeader>
                <CardContent className="space-y-6">
                    {initialLoading && (
                        <div className="space-y-3">
                            <Skeleton className="h-4 w-48" />
                            <div className="flex items-center gap-2">
                                <Skeleton className="h-9 w-64" />
                                <Skeleton className="h-9 w-9 rounded-md" />
                            </div>
                            <Skeleton className="h-9 w-24" />
                        </div>
                    )}
                    <div>
                        <Label className="mb-2 block">Available accounts</Label>
                        {accounts.length ? (
                            <div className="flex items-center gap-2">
                                <Select
                                    value={selectedAccount}
                                    onValueChange={setSelectedAccount}
                                >
                                    <SelectTrigger className="text-foreground">
                                        <SelectValue placeholder="Choose an account" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {accounts.map((acct) => (
                                            <SelectItem key={acct} value={acct}>
                                                {acct}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    onClick={() => setShowImport(true)}
                                    aria-label="Import account"
                                >
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>
                        ) : (
                            <div className="text-muted-foreground text-sm">
                                No accounts yet.
                            </div>
                        )}
                        {accounts.length ? (
                            <div className="mt-3">
                                <Button
                                    onClick={login}
                                    disabled={!selectedAccount || isLoading}
                                >
                                    {isLoading ? "Logging in..." : "Login"}
                                </Button>
                            </div>
                        ) : (
                            <div className="mt-3 flex items-center gap-2">
                                <Input
                                    className="text-foreground placeholder:text-muted-foreground flex-1"
                                    placeholder="Enter account name"
                                    value={newAccount}
                                    onChange={(e) =>
                                        setNewAccount(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") importExisting();
                                    }}
                                />
                                <Button
                                    onClick={importExisting}
                                    disabled={!newAccount.trim() || isImporting}
                                >
                                    {isImporting ? "Importing..." : "Import"}
                                </Button>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
            <Dialog open={showImport} onOpenChange={setShowImport}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Import existing account</DialogTitle>
                    </DialogHeader>
                    <div className="flex gap-2">
                        <Input
                            className="text-foreground placeholder:text-muted-foreground flex-1"
                            placeholder="Enter account name"
                            value={newAccount}
                            onChange={(e) => setNewAccount(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") importExisting();
                            }}
                        />
                        <Button
                            onClick={importExisting}
                            disabled={!newAccount.trim() || isImporting}
                        >
                            {isImporting ? "Importing..." : "Import"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};
