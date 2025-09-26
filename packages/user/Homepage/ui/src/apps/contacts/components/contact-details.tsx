import {
    ArrowLeft,
    Copy,
    Edit,
    Mail,
    MoreVertical,
    Phone,
    Trash,
    Wallet,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { useCurrentUser } from "@/hooks/use-current-user";
import { useProfile } from "@/hooks/use-profile";

import { useAvatar } from "@shared/hooks/use-avatar";
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

import { useDeleteContact } from "../hooks/use-delete-contact";
import { useUpdateContact } from "../hooks/use-update-contact";
import { LocalContact } from "../types";
import { formatNames } from "../utils/formatNames";
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

export function ContactDetails({
    contact,
    onTransferFunds,
    onChainMailUser,
    onBack,
}: ContactDetailsProps) {
    if (!contact) {
        return (
            <div className="flex h-full items-center justify-center">
                Select a contact to view details
            </div>
        );
    }

    const { data: currentUser } = useCurrentUser();

    const isSelf = contact.account === currentUser;
    const { data: profile } = useProfile(contact.account);

    const { avatarSrc } = useAvatar(contact.account);

    const [primaryName, secondaryName] = formatNames(
        contact.nickname,
        profile?.profile?.displayName,
        contact.account,
    );

    const { mutateAsync: deleteContact } = useDeleteContact();

    const [modalPage, setModalPage] = useState<z.infer<typeof modalPages>>(
        modalPages.Values.closed,
    );

    const closeModal = () => {
        setModalPage(modalPages.Values.closed);
    };

    const { mutateAsync: updateContact } = useUpdateContact();
    const showModal = modalPage !== modalPages.Values.closed;

    return (
        <div className="flex h-full w-full flex-col">
            {/* Header with back button on mobile */}
            <div className="flex items-center gap-2 border-b p-4">
                {onBack && (
                    <Button variant="ghost" size="icon" onClick={onBack}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                )}
                <div className="flex flex-1 items-center justify-between text-lg font-semibold">
                    <h2 className="text-lg">{primaryName}</h2>
                    <DropdownMenu>
                        <DropdownMenuTrigger>
                            <Button variant="ghost" size="icon">
                                <MoreVertical />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                            <DropdownMenuItem
                                onClick={() => {
                                    setModalPage(modalPages.Values.editContact);
                                }}
                            >
                                <Edit className="mr-2 h-4 w-4" />
                                Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                disabled={isSelf}
                                onClick={() => {
                                    setModalPage(
                                        modalPages.Values.deleteContact,
                                    );
                                }}
                            >
                                <Trash className="mr-2 h-4 w-4" />
                                Delete
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
                                <div className="py-2">
                                    These details are stored locally and not
                                    sent to the network.
                                </div>
                                {isSelf && (
                                    <div className="py-2">
                                        Edit your{" "}
                                        <button
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
                                    </div>
                                )}

                                <ContactForm
                                    initialValues={contact}
                                    onSubmit={async (data) => {
                                        await updateContact(data);
                                        closeModal();
                                    }}
                                />
                            </DialogDescription>
                        </DialogHeader>
                    </DialogContent>
                ) : modalPage === modalPages.Values.deleteContact ? (
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Delete contact</DialogTitle>
                            <DialogDescription>
                                This will permanently delete the contact{" "}
                                <span className="font-bold">
                                    @{contact.account}
                                </span>
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button
                                onClick={async () => {
                                    await deleteContact(contact.account);
                                    closeModal();
                                }}
                            >
                                Confirm
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
            <div className="mx-auto flex w-full max-w-screen-md flex-col items-center justify-center gap-4 p-4">
                <div className="flex w-full justify-center">
                    <img
                        src={avatarSrc}
                        alt="Contact avatar"
                        className="h-56 w-full rounded-none object-contain"
                    />
                </div>
                <div className="flex flex-col gap-2 text-center">
                    <div className="text-lg font-medium">{primaryName}</div>
                    {secondaryName && (
                        <div className="flex flex-col gap-1">
                            <div className="text-muted-foreground text-sm">
                                {secondaryName?.toLowerCase()}
                            </div>
                        </div>
                    )}
                    {profile?.profile?.bio && (
                        <div className="flex flex-col gap-1">
                            <div className="text-muted-foreground text-sm">
                                {profile?.profile?.bio}
                            </div>
                        </div>
                    )}
                    <div className="text-muted-foreground flex w-full justify-center gap-2 ">
                        <Button
                            onClick={() => onTransferFunds(contact.account)}
                            size="icon"
                            variant="outline"
                            className="hover:text-primary"
                        >
                            <Wallet />
                        </Button>
                        <Button
                            onClick={() => onChainMailUser(contact.account)}
                            size="icon"
                            variant="outline"
                            className="hover:text-primary"
                        >
                            <Mail />
                        </Button>
                    </div>
                </div>
            </div>
            <div className="mx-auto grid max-w-screen-sm grid-cols-1 gap-3 p-4">
                {contact.phone && (
                    <div className="flex items-center justify-between rounded-md border px-4 py-2">
                        <span>{contact.phone}</span>
                        <div className="flex gap-2">
                            <Button
                                onClick={() => {
                                    navigator.clipboard.writeText(
                                        contact.phone!,
                                    );
                                }}
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground hover:text-primary"
                            >
                                <Copy className="h-5 w-5" />
                            </Button>
                            <Button
                                onClick={() => {
                                    window.open(
                                        `tel:${contact.phone}`,
                                        "_blank",
                                    );
                                }}
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground hover:text-primary"
                            >
                                <Phone className="h-5 w-5" />
                            </Button>
                        </div>
                    </div>
                )}
                {contact.email && (
                    <div className="flex items-center justify-between rounded-md border px-4 py-2">
                        <span>{contact.email}</span>
                        <div className="flex gap-2">
                            <Button
                                onClick={() => {
                                    navigator.clipboard.writeText(
                                        contact.email!,
                                    );
                                }}
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground hover:text-primary"
                            >
                                <Copy className="h-5 w-5" />
                            </Button>
                            <Button
                                onClick={() => {
                                    window.open(
                                        `mailto:${contact.email}`,
                                        "_blank",
                                    );
                                }}
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground hover:text-primary"
                            >
                                <Mail className="h-5 w-5" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
