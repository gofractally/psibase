import {
    ArrowLeft,
    Edit,
    Mail,
    MessageCircle,
    MoreVertical,
    Phone,
    Trash,
    UserRound,
    Wallet,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { CopyIcon } from "@/components/account-cell";
import { EmptyState } from "@/components/empty-state";
import { KeyValue, Panel } from "@/components/page-header";

import { colorFor } from "@/lib/colors";

import { Avatar } from "@shared/components/avatar";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useProfile } from "@shared/hooks/use-profile";
import { Badge } from "@shared/shadcn/ui/badge";
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
    DropdownMenuTrigger,
} from "@shared/shadcn/ui/dropdown-menu";
import { ScrollArea } from "@shared/shadcn/ui/scroll-area";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

import { useDeleteContact } from "../hooks/use-delete-contact";
import { useUpdateContact } from "../hooks/use-update-contact";
import { LocalContact } from "../types";
import { formatNames } from "../utils/format-names";
import { ContactForm } from "./contact-form";
import { EditProfileDialogContent } from "./edit-profile-dialog";

interface ContactDetailsProps {
    contact: LocalContact | undefined;
    onTransferFunds: (contactId: string) => void;
    onChainMailUser: (contactId: string) => void;
    onBack?: () => void;
}

const modalPages = z.enum([
    "editProfile",
    "editContact",
    "deleteContact",
    "closed",
]);

const ValueWithActions = ({
    value,
    href,
    hrefIcon: HrefIcon,
    hrefLabel,
    mono,
}: {
    value: string;
    href?: string;
    hrefIcon?: typeof Mail;
    hrefLabel?: string;
    mono?: boolean;
}) => (
    <span className="group/value flex min-w-0 items-center gap-1.5">
        <span className={mono ? "truncate font-mono" : "truncate"}>
            {value}
        </span>
        <CopyIcon value={value} />
        {href && HrefIcon && (
            <Tooltip>
                <TooltipTrigger asChild>
                    <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground inline-flex size-5 items-center justify-center rounded transition-colors"
                        aria-label={hrefLabel}
                    >
                        <HrefIcon className="size-3" />
                    </a>
                </TooltipTrigger>
                <TooltipContent>{hrefLabel}</TooltipContent>
            </Tooltip>
        )}
    </span>
);

export function ContactDetails({
    contact,
    onTransferFunds,
    onChainMailUser,
    onBack,
}: ContactDetailsProps) {
    const [modalPage, setModalPage] = useState<z.infer<typeof modalPages>>(
        modalPages.Values.closed,
    );

    const { data: currentUser } = useCurrentUser();
    const { data: profile } = useProfile(contact?.account, true, {});

    const { mutateAsync: updateContact } = useUpdateContact();
    const { mutateAsync: deleteContact } = useDeleteContact();

    const closeModal = () => {
        setModalPage(modalPages.Values.closed);
    };
    const showModal = modalPage !== modalPages.Values.closed;
    if (!contact) {
        return (
            <EmptyState
                icon={UserRound}
                detail="Choose a contact from the list to see their details."
                className="h-full"
            >
                Select a contact
            </EmptyState>
        );
    }

    const isSelf = contact.account === currentUser;
    const [primaryName, secondaryName] = formatNames(
        contact.nickname,
        profile?.profile?.displayName,
        contact.account,
    );
    const displayName = profile?.profile?.displayName?.trim();
    const bio = profile?.profile?.bio?.trim();
    const accent = colorFor(contact.account);

    return (
        <div className="flex h-full min-h-0 w-full flex-col">
            <div className="border-border flex items-center gap-2 border-b px-4 py-2.5">
                {onBack && (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={onBack}
                        aria-label="Back to contacts"
                    >
                        <ArrowLeft className="size-4" />
                    </Button>
                )}
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                    <h2 className="truncate text-sm font-semibold">
                        {primaryName}
                    </h2>
                    {isSelf && (
                        <Badge
                            variant="secondary"
                            className="h-4 px-1.5 text-[10px]"
                        >
                            you
                        </Badge>
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                            setModalPage(modalPages.Values.editContact)
                        }
                    >
                        <Edit className="size-3.5" />
                        Edit
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="More actions"
                            >
                                <MoreVertical className="size-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {isSelf && (
                                <DropdownMenuItem
                                    onClick={() =>
                                        setModalPage(
                                            modalPages.Values.editProfile,
                                        )
                                    }
                                >
                                    <UserRound className="size-4" />
                                    Edit public profile
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                                disabled={isSelf}
                                variant="destructive"
                                onClick={() => {
                                    setModalPage(
                                        modalPages.Values.deleteContact,
                                    );
                                }}
                            >
                                <Trash className="size-4" />
                                Delete contact
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            <Dialog
                open={showModal}
                onOpenChange={(open) => {
                    if (!open) {
                        closeModal();
                    }
                }}
            >
                {modalPage === modalPages.Values.editContact ? (
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Edit contact</DialogTitle>
                            <DialogDescription>
                                These details are stored locally and not sent to
                                the network.
                                {isSelf && (
                                    <>
                                        {" "}
                                        Edit your{" "}
                                        <button
                                            type="button"
                                            className="hover:text-primary underline focus:outline-none"
                                            onClick={() =>
                                                setModalPage(
                                                    modalPages.Values
                                                        .editProfile,
                                                )
                                            }
                                        >
                                            profile
                                        </button>{" "}
                                        to update your public information.
                                    </>
                                )}
                            </DialogDescription>
                        </DialogHeader>
                        <ContactForm
                            initialValues={contact}
                            onSubmit={async (data) => {
                                await updateContact(data);
                                closeModal();
                            }}
                        />
                    </DialogContent>
                ) : modalPage === modalPages.Values.deleteContact ? (
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Delete contact</DialogTitle>
                            <DialogDescription>
                                This removes{" "}
                                <span className="text-foreground font-mono">
                                    {contact.account}
                                </span>{" "}
                                from your local contacts. It does not affect the
                                account itself.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="outline" onClick={closeModal}>
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={async () => {
                                    await deleteContact(contact.account);
                                    closeModal();
                                }}
                            >
                                Delete
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                ) : modalPage === modalPages.Values.editProfile ? (
                    <EditProfileDialogContent
                        onClose={() => {
                            closeModal();
                        }}
                    />
                ) : (
                    <DialogContent>
                        <div>Error: Unrecognised modal page</div>
                    </DialogContent>
                )}
            </Dialog>

            <ScrollArea className="min-h-0 flex-1">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                        <Avatar
                            account={contact.account}
                            className="bg-card size-20 shrink-0 rounded-xl border-2 object-cover"
                            style={{ borderColor: accent }}
                            alt="Contact avatar"
                        />
                        <div className="min-w-0 flex-1">
                            <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-[0.2em]">
                                {isSelf ? "your account" : "contact"}
                            </div>
                            <h3 className="mt-0.5 truncate text-2xl font-semibold tracking-tight">
                                {primaryName}
                            </h3>
                            {secondaryName && (
                                <div className="flex items-center gap-1.5">
                                    <span className="text-muted-foreground truncate font-mono text-sm">
                                        {secondaryName.toLowerCase()}
                                    </span>
                                    <CopyIcon value={contact.account} />
                                </div>
                            )}
                            {bio && (
                                <p className="text-muted-foreground mt-2 max-w-prose text-sm">
                                    {bio}
                                </p>
                            )}
                            <div className="mt-3 flex flex-wrap gap-2">
                                <Button
                                    onClick={() =>
                                        onTransferFunds(contact.account)
                                    }
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    disabled={isSelf}
                                >
                                    <Wallet className="size-3.5" />
                                    Send tokens
                                </Button>
                                <Button
                                    onClick={() =>
                                        onChainMailUser(contact.account)
                                    }
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    disabled={isSelf}
                                >
                                    <MessageCircle className="size-3.5" />
                                    Message
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                        <Panel
                            title="Local details"
                            description="Only visible to you"
                        >
                            <KeyValue label="Account">
                                <ValueWithActions
                                    value={contact.account}
                                    mono
                                />
                            </KeyValue>
                            <KeyValue label="Nickname">
                                {contact.nickname || (
                                    <span className="text-muted-foreground italic">
                                        not set
                                    </span>
                                )}
                            </KeyValue>
                            <KeyValue label="Email">
                                {contact.email ? (
                                    <ValueWithActions
                                        value={contact.email}
                                        href={`mailto:${contact.email}`}
                                        hrefIcon={Mail}
                                        hrefLabel="Send email"
                                    />
                                ) : (
                                    <span className="text-muted-foreground italic">
                                        not set
                                    </span>
                                )}
                            </KeyValue>
                            <KeyValue label="Phone">
                                {contact.phone ? (
                                    <ValueWithActions
                                        value={contact.phone}
                                        href={`tel:${contact.phone}`}
                                        hrefIcon={Phone}
                                        hrefLabel="Call"
                                    />
                                ) : (
                                    <span className="text-muted-foreground italic">
                                        not set
                                    </span>
                                )}
                            </KeyValue>
                        </Panel>

                        <Panel
                            title="Public profile"
                            description="Published on the network by the account owner"
                            actions={
                                isSelf ? (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 text-xs"
                                        onClick={() =>
                                            setModalPage(
                                                modalPages.Values.editProfile,
                                            )
                                        }
                                    >
                                        <Edit className="size-3.5" />
                                        Edit
                                    </Button>
                                ) : undefined
                            }
                        >
                            <KeyValue label="Display name">
                                {displayName || (
                                    <span className="text-muted-foreground italic">
                                        not set
                                    </span>
                                )}
                            </KeyValue>
                            <KeyValue label="Bio">
                                {bio ? (
                                    <span className="whitespace-pre-wrap">
                                        {bio}
                                    </span>
                                ) : (
                                    <span className="text-muted-foreground italic">
                                        not set
                                    </span>
                                )}
                            </KeyValue>
                            <KeyValue label="Profile">
                                {profile?.profile ? (
                                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                        published
                                    </span>
                                ) : (
                                    <span className="text-muted-foreground italic">
                                        not published
                                    </span>
                                )}
                            </KeyValue>
                        </Panel>
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
}
