import { Plus, Trash } from "lucide-react";
import { useState } from "react";

import { useToast } from "@/components/ui/use-toast";

import { EmptyBlock } from "@shared/components/empty-block";
import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@shared/shadcn/ui/alert-dialog";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

import {
    useAdminAccounts,
    useSetAdminAccount,
} from "../hooks/use-admin-accounts";

export const NodeAdminsContent = () => {
    const { data: adminAccounts, isLoading, isError } = useAdminAccounts();
    const { mutateAsync: setAdminAccount, isPending } = useSetAdminAccount();
    const { toast } = useToast();

    const [showAddAdmin, setShowAddAdmin] = useState(false);
    const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);

    const addForm = useAppForm({
        defaultValues: {
            admin: {
                account: "",
            },
        },
        onSubmit: async ({
            formApi,
            value: {
                admin: { account },
            },
        }) => {
            try {
                await setAdminAccount({ account, admin: true });
                setShowAddAdmin(false);
                formApi.reset();
                toast({
                    title: "Node admin added",
                    description: `${account} is now a node admin`,
                });
            } catch {
                toast({
                    title: "Error",
                    description: "Failed to add node admin",
                });
            }
        },
    });

    const onRemoveAdmin = async (account: string) => {
        try {
            await setAdminAccount({ account, admin: false });
            toast({
                title: "Node admin removed",
                description: `${account} is no longer a node admin`,
            });
        } catch {
            toast({
                title: "Error",
                description: "Failed to remove node admin",
            });
        }
    };

    const admins = adminAccounts ?? [];

    return (
        <>
            <Dialog
                open={showAddAdmin}
                onOpenChange={(show) => {
                    setShowAddAdmin(show);
                    if (!show) {
                        addForm.reset();
                    }
                }}
            >
                <DialogContent>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            // React submit events bubble through the portal
                            // into the enclosing Setup form.
                            e.stopPropagation();
                            void addForm.handleSubmit();
                        }}
                    >
                        <DialogHeader>
                            <DialogTitle>Add node admin</DialogTitle>
                        </DialogHeader>
                        <div className="py-4">
                            <FieldAccountExisting
                                form={addForm}
                                fields="admin"
                                label="Account name"
                                description={undefined}
                                placeholder="Account name"
                                disabled={isPending}
                                onValidate={undefined}
                            />
                        </div>
                        <DialogFooter>
                            <addForm.AppForm>
                                <addForm.SubmitButton
                                    labels={["Add", "Adding..."]}
                                />
                            </addForm.AppForm>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <AlertDialog
                open={pendingRemoval !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingRemoval(null);
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Remove {pendingRemoval} as a node admin?
                        </AlertDialogTitle>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            onClick={() => {
                                if (pendingRemoval) {
                                    void onRemoveAdmin(pendingRemoval);
                                }
                            }}
                        >
                            Remove
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <div className="flex items-center justify-between py-2">
                <div>
                    <h3 className="text-lg font-semibold tracking-tight">
                        Node admins
                    </h3>
                </div>
                {admins.length !== 0 && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAddAdmin(true)}
                    >
                        <Plus />
                        Add
                    </Button>
                )}
            </div>
            {isLoading ? (
                <div className="space-y-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                </div>
            ) : isError ? (
                <p className="text-muted-foreground text-sm">
                    Error loading node admins.
                </p>
            ) : admins.length === 0 ? (
                <EmptyBlock
                    buttonLabel="Add node admin"
                    onButtonClick={() => setShowAddAdmin(true)}
                    title="No node admins"
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
                        {admins.map((account) => (
                            <TableRow key={account}>
                                <TableCell>{account}</TableCell>
                                <TableCell>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        disabled={isPending}
                                        onClick={() =>
                                            setPendingRemoval(account)
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
        </>
    );
};
