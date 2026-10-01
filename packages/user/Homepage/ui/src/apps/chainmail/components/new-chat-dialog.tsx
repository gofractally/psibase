import { NotebookPen } from "lucide-react";
import { z } from "zod";

import { SectionLabel } from "@/components/page-header";

import { Avatar } from "@shared/components/avatar";
import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import { useBranding } from "@shared/hooks/use-branding";
import { useContacts } from "@shared/hooks/use-contacts";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useHasProfilesReadPermission } from "@shared/hooks/use-has-profiles-read-permission";
import { zAccount } from "@shared/lib/schemas/account";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onStart: (account: string) => void;
}

export const NewChatDialog = ({ open, onOpenChange, onStart }: Props) => {
    const { data: user } = useCurrentUser();
    const { data: networkName } = useBranding();
    const { data: hasPermission } = useHasProfilesReadPermission({
        enabled: !!user && open,
    });
    const { data: contacts } = useContacts(user, {
        enabled: !!hasPermission && open,
    });
    const others = contacts?.filter((c) => c.account !== user) ?? [];

    const form = useAppForm({
        defaultValues: { to: { account: "" } },
        validators: {
            onSubmit: z.object({ to: z.object({ account: zAccount }) }),
        },
        onSubmit: ({ value }) => {
            start(value.to.account);
        },
    });

    const start = (account: string) => {
        form.reset();
        onStart(account);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(o) => {
                if (!o) form.reset();
                onOpenChange(o);
            }}
        >
            <DialogContent className="gap-0 p-0 sm:max-w-md">
                <DialogHeader className="border-b px-5 py-4">
                    <DialogTitle className="text-base">New chat</DialogTitle>
                    <DialogDescription className="text-xs">
                        Message anyone on {networkName || "the network"} by
                        their account name.
                    </DialogDescription>
                </DialogHeader>
                <form.AppForm>
                    <form
                        className="flex items-start gap-2 px-5 py-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void form.handleSubmit();
                        }}
                    >
                        <div className="min-w-0 flex-1">
                            <FieldAccountExisting
                                form={form}
                                fields="to"
                                label={undefined}
                                description={undefined}
                                placeholder="Account name"
                                disabled={false}
                                onValidate={undefined}
                            />
                        </div>
                        {/* TextField keeps an empty label row (plus gap) above its input. */}
                        <Button type="submit" className="mt-2 shrink-0">
                            Start
                        </Button>
                    </form>
                </form.AppForm>
                <div className="border-t pb-2">
                    <SectionLabel className="px-5 pt-3">Suggested</SectionLabel>
                    <ul className="scrollbar-thin max-h-64 overflow-y-auto px-2">
                        {user && (
                            <SuggestionRow
                                account={user}
                                title="Notes to self"
                                icon={
                                    <span className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-full">
                                        <NotebookPen className="size-4" />
                                    </span>
                                }
                                onPick={start}
                            />
                        )}
                        {others.map((c) => (
                            <SuggestionRow
                                key={c.account}
                                account={c.account}
                                title={c.nickname || c.account}
                                onPick={start}
                            />
                        ))}
                    </ul>
                    {hasPermission === false && (
                        <p className="text-muted-foreground px-5 py-2 text-xs">
                            Open Contacts once to see your contacts here.
                        </p>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

const SuggestionRow = ({
    account,
    title,
    icon,
    onPick,
}: {
    account: string;
    title: string;
    icon?: React.ReactNode;
    onPick: (account: string) => void;
}) => (
    <li>
        <button
            type="button"
            onClick={() => onPick(account)}
            className="hover:bg-accent/50 flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left transition-colors"
        >
            {icon ?? (
                <Avatar
                    account={account}
                    className="size-8 border-0 shadow-none"
                    alt=""
                />
            )}
            <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm font-medium">{title}</span>
                <span className="text-muted-foreground truncate font-mono text-[11px]">
                    @{account}
                </span>
            </span>
        </button>
    </li>
);
