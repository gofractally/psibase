import { RotateCcw, X } from "lucide-react";
import { useState } from "react";

import { useAppForm } from "@/components/forms/app-form";
import { PackageItem } from "@/components/package-item";

import { useInstallPackages } from "@/hooks/use-install-packages";
import { usePackages } from "@/hooks/use-packages";
import { useSetAccountSources } from "@/hooks/use-set-sources";
import { useSources } from "@/hooks/use-sources";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { zAccount } from "@/lib/zod/Account";

import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@shared/shadcn/ui/dialog";

export const Packages = () => {
    const { data, isLoading } = usePackages();

    const [selectedId, setSelectedId] = useState("");
    const { mutateAsync: installPackages, isPending } = useInstallPackages();
    const { mutateAsync: setAccountSources } = useSetAccountSources();

    const { data: currentUser } = useCurrentUser();
    const { data: sources } = useSources(currentUser);

    const form = useAppForm({
        defaultValues: {
            accounts: [] as string[],
        },
        onSubmit: async (data) => {
            await setAccountSources(
                zAccount.array().parse(data.value.accounts),
            );
        },
    });

    const onReset = () => {
        form.reset();
    };

    return (
        <div className="mx-auto w-full max-w-screen-lg space-y-6 px-2">
            <div className="flex flex-col gap-3">
                <div className="flex justify-between">
                    <div>
                        <h2 className="text-lg font-medium">Packages</h2>
                        <p className="text-muted-foreground text-sm">
                            Upload and deploy packages
                        </p>
                    </div>
                    <div className="flex items-center">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="secondary">
                                    Update sources
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Sources</DialogTitle>
                                    <DialogDescription>
                                        Enter account sources to fetch packages
                                        from.
                                    </DialogDescription>
                                    <form
                                        className="py-2"
                                        onSubmit={(e) => {
                                            e.preventDefault();
                                            void form.handleSubmit();
                                        }}
                                    >
                                        <form.AppField
                                            name="accounts"
                                            mode="array"
                                        >
                                            {(field) => {
                                                return (
                                                    <div className="flex flex-col gap-2 ">
                                                        {field.state.value.map(
                                                            (_, i) => (
                                                                <form.AppField
                                                                    key={i}
                                                                    name={`accounts[${i}]`}
                                                                >
                                                                    {(
                                                                        subField,
                                                                    ) => {
                                                                        return (
                                                                            <div className="flex w-full items-center gap-2">
                                                                                <subField.TextField />

                                                                                <Button
                                                                                    type="button"
                                                                                    variant={
                                                                                        "outline"
                                                                                    }
                                                                                    onClick={(
                                                                                        e,
                                                                                    ) => {
                                                                                        e.preventDefault();
                                                                                        field.removeValue(
                                                                                            i,
                                                                                        );
                                                                                    }}
                                                                                >
                                                                                    <X />
                                                                                </Button>
                                                                            </div>
                                                                        );
                                                                    }}
                                                                </form.AppField>
                                                            ),
                                                        )}
                                                    </div>
                                                );
                                            }}
                                        </form.AppField>

                                        <div className="flex justify-between py-2">
                                            <Button
                                                variant="outline"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    form.setFieldValue(
                                                        "accounts",
                                                        (accounts) => [
                                                            ...accounts,
                                                            "",
                                                        ],
                                                    );
                                                }}
                                            >
                                                New source
                                            </Button>
                                            <div className="flex gap-2">
                                                <Button
                                                    onClick={() => {
                                                        onReset();
                                                    }}
                                                    variant="outline"
                                                    size="icon"
                                                >
                                                    <RotateCcw />
                                                </Button>
                                                <form.AppForm>
                                                    <form.SubmitButton
                                                        labels={[
                                                            "Save",
                                                            "Saving",
                                                        ]}
                                                    />
                                                </form.AppForm>
                                            </div>
                                        </div>
                                    </form>
                                </DialogHeader>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>
                <div className="flex flex-col gap-2">
                    {data.map((pack) => (
                        <PackageItem
                            pack={pack}
                            onClick={(id) => {
                                installPackages([id]);
                                setSelectedId(id);
                            }}
                            key={pack.id}
                            isLoading={isLoading && selectedId == pack.id}
                            isMutating={isPending && selectedId == pack.id}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};
