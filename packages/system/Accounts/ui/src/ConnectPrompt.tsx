import { useCallback, useEffect, useState } from "react";

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
const fc = (
    service: string,
    plugin: string,
    intf: string,
    method: string,
    params: unknown[] = [],
) => supervisor.functionCall({ service, plugin, intf, method, params });

const pluginApi = {
    getAllAccounts: () => fc("accounts", "plugin", "admin", "getAllAccounts"),
    importAccount: (accountName: string) =>
        fc("accounts", "plugin", "prompt", "importExisting", [accountName]),
    connectAccount: (accountName: string) =>
        fc("accounts", "plugin", "prompt", "connectAccount", [accountName]),
    getActiveApp: () => fc("host", "common", "client", "getActiveApp", []),
};

type ComponentState = "initial" | "login" | "import" | "importing" | "idle";

const useComponentState = () => {
    const [state, setState] = useState<ComponentState>("initial");
    return { state, setState };
};

const useErrorHandler = (setError: (error: string | null) => void) => {
    const tryExecute = async <T,>(
        operation: () => Promise<T>,
        errorMessage: string,
        onError?: () => void,
    ): Promise<T | undefined> => {
        setError(null);
        try {
            return await operation();
        } catch {
            setError(errorMessage);
            onError?.();
            return undefined;
        }
    };

    return { tryExecute };
};

const useAccounts = (errorHandler: ReturnType<typeof useErrorHandler>) => {
    const [accounts, setAccounts] = useState<string[]>([]);
    const [selectedAccount, setSelectedAccount] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);
    const { tryExecute } = errorHandler;

    const selectDefaultAccount = useCallback(
        (accounts: string[], currentSelection: string): string => {
            return accounts.includes(currentSelection)
                ? currentSelection
                : (accounts[0] ?? "");
        },
        [],
    );

    const loadAccounts = useCallback(async () => {
        if (isLoading) return;
        setIsLoading(true);

        const result = await tryExecute(
            pluginApi.getAllAccounts,
            "Failed to load accounts",
        );
        if (result) {
            const list = Array.isArray(result) ? (result as string[]) : [];
            setAccounts(list);
            setSelectedAccount((prev) => selectDefaultAccount(list, prev));
        }
        setIsLoading(false);
    }, [isLoading, tryExecute, selectDefaultAccount]);

    return {
        accounts,
        selectedAccount,
        setSelectedAccount,
        loadAccounts,
        isLoadingAccounts: isLoading,
    };
};

const useActiveApp = () => {
    const [activeApp, setActiveApp] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);

    const loadActiveApp = useCallback(async () => {
        if (isLoading) return;
        setIsLoading(true);

        try {
            const result = await pluginApi.getActiveApp();
            setActiveApp(String(result || ""));
        } catch {
            setActiveApp("");
        } finally {
            setIsLoading(false);
        }
    }, [isLoading]);

    return { activeApp, loadActiveApp, isLoadingActiveApp: isLoading };
};

const useAccountImport = (
    loadAccounts: () => Promise<void>,
    setSelectedAccount: (account: string) => void,
    errorHandler: ReturnType<typeof useErrorHandler>,
    setState: (state: ComponentState) => void,
) => {
    const [newAccount, setNewAccount] = useState<string>("");
    const { tryExecute } = errorHandler;

    const importExisting = async () => {
        const acct = newAccount.trim();
        if (!acct) return;
        setState("importing");

        const result = await tryExecute(
            async () => {
                await pluginApi.importAccount(acct);
                await loadAccounts();
                return true;
            },
            "Import failed",
            () => setState("import"),
        );

        if (result) {
            setSelectedAccount(acct);
            setNewAccount("");
            setState("idle");
        }
    };

    return {
        newAccount,
        setNewAccount,
        importExisting,
    };
};

const LoadingSkeleton = () => (
    <div className="space-y-3">
        <Skeleton className="h-4 w-48" />
        <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-9 w-9 rounded-md" />
        </div>
        <Skeleton className="h-9 w-24" />
    </div>
);

const AccountSelector = ({
    accounts,
    selectedAccount,
    setSelectedAccount,
}: {
    accounts: string[];
    selectedAccount: string;
    setSelectedAccount: (account: string) => void;
}) => (
    <Select value={selectedAccount} onValueChange={setSelectedAccount}>
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
);

const ImportAccountButton = ({
    setState,
}: {
    setState: (state: ComponentState) => void;
}) => (
    <Button type="button" variant="outline" onClick={() => setState("import")}>
        Import existing account
    </Button>
);

const AccountImportInput = ({
    newAccount,
    setNewAccount,
    isImporting,
    importExisting,
    className = "",
}: {
    newAccount: string;
    setNewAccount: (value: string) => void;
    isImporting: boolean;
    importExisting: () => void;
    className?: string;
}) => (
    <div className={`flex items-center gap-2 ${className}`}>
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
);

const LoginButton = ({
    selectedAccount,
    login,
    isLoggingIn,
}: {
    selectedAccount: string;
    login: () => void;
    isLoggingIn: boolean;
}) => (
    <div className="mt-3">
        <Button onClick={login} disabled={!selectedAccount || isLoggingIn}>
            {isLoggingIn ? "Logging in..." : "Login"}
        </Button>
    </div>
);

const ExistingAccountsView = ({
    accounts,
    selectedAccount,
    setSelectedAccount,
    setState,
    login,
    isLoggingIn,
}: {
    accounts: string[];
    selectedAccount: string;
    setSelectedAccount: (account: string) => void;
    setState: (state: ComponentState) => void;
    login: () => void;
    isLoggingIn: boolean;
}) => (
    <>
        <AccountSelector
            accounts={accounts}
            selectedAccount={selectedAccount}
            setSelectedAccount={setSelectedAccount}
        />
        <ImportAccountButton setState={setState} />
        <LoginButton
            selectedAccount={selectedAccount}
            login={login}
            isLoggingIn={isLoggingIn}
        />
    </>
);

const NoAccountsView = ({
    setState,
}: {
    setState: (state: ComponentState) => void;
}) => (
    <>
        <div className="text-muted-foreground text-sm">No accounts yet.</div>
        <div className="mt-3">
            <ImportAccountButton setState={setState} />
        </div>
    </>
);

const ErrorDisplay = ({ error }: { error: string }) => (
    <div className="border-destructive/40 bg-destructive/10 text-destructive rounded border p-2">
        {error}
    </div>
);

const ConnectHeader = ({
    activeApp,
    error,
}: {
    activeApp: string;
    error: string | null;
}) => (
    <CardHeader>
        <CardTitle className="text-3xl">
            {activeApp ? `Connect to ${activeApp}` : "Connect an account"}
        </CardTitle>
        {error && <ErrorDisplay error={error} />}
    </CardHeader>
);

const MainContent = ({
    state,
    setState,
    accounts,
    selectedAccount,
    setSelectedAccount,
    login,
}: {
    state: ComponentState;
    setState: (state: ComponentState) => void;
    accounts: string[];
    selectedAccount: string;
    setSelectedAccount: (account: string) => void;
    login: () => void;
}) => (
    <CardContent className="space-y-6">
        {state === "initial" ? (
            <LoadingSkeleton />
        ) : (
            <div>
                <Label className="mb-2 block">Available accounts</Label>
                {accounts.length > 0 ? (
                    <ExistingAccountsView
                        accounts={accounts}
                        selectedAccount={selectedAccount}
                        setSelectedAccount={setSelectedAccount}
                        setState={setState}
                        login={login}
                        isLoggingIn={state === "login"}
                    />
                ) : (
                    <NoAccountsView setState={setState} />
                )}
            </div>
        )}
    </CardContent>
);

const ImportDialog = ({
    state,
    onClose,
    newAccount,
    setNewAccount,
    importExisting,
}: {
    state: ComponentState;
    onClose: () => void;
    newAccount: string;
    setNewAccount: (value: string) => void;
    importExisting: () => void;
}) => {
    const isOpen = state === "import" || state === "importing";
    const isImporting = state === "importing";

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Import existing account</DialogTitle>
                </DialogHeader>
                <AccountImportInput
                    newAccount={newAccount}
                    setNewAccount={setNewAccount}
                    isImporting={isImporting}
                    importExisting={importExisting}
                />
            </DialogContent>
        </Dialog>
    );
};

export const ConnectPrompt = () => {
    const [error, setError] = useState<string | null>(null);
    const [isInit, setInit] = useState(false);
    const errorHandler = useErrorHandler(setError);
    const { state, setState } = useComponentState();

    const { accounts, selectedAccount, setSelectedAccount, loadAccounts } =
        useAccounts(errorHandler);
    const { activeApp, loadActiveApp } = useActiveApp();
    const { newAccount, setNewAccount, importExisting } = useAccountImport(
        loadAccounts,
        setSelectedAccount,
        errorHandler,
        setState,
    );

    useEffect(() => {
        if (!isInit) {
            Promise.all([loadAccounts(), loadActiveApp()]).finally(() => {
                setState("idle");
                setInit(true);
            });
        }
    }, [isInit, loadAccounts, loadActiveApp, setState]);

    const login = async () => {
        if (!selectedAccount) return;
        setState("login");

        const result = await errorHandler.tryExecute(
            async () => {
                await pluginApi.connectAccount(selectedAccount);
                prompt.finished();
                return true;
            },
            "Login failed",
            () => setState("idle"),
        );

        if (result) {
            // Login successful, prompt.finished() was called
        }
    };

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-md p-6">
            <Card>
                <ConnectHeader activeApp={activeApp} error={error} />
                <MainContent
                    state={state}
                    setState={setState}
                    accounts={accounts}
                    selectedAccount={selectedAccount}
                    setSelectedAccount={setSelectedAccount}
                    login={login}
                />
            </Card>
            <ImportDialog
                state={state}
                onClose={() => setState("idle")}
                newAccount={newAccount}
                setNewAccount={setNewAccount}
                importExisting={importExisting}
            />
        </div>
    );
};
