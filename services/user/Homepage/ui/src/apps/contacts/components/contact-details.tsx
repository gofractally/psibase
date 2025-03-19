import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { useAvatar } from "@/hooks/useAvatar";
import { z } from "zod";
import { LocalContact } from "../types";
import { useProfile } from "@/hooks/useProfile";
import { useDeleteContact } from "../hooks/useDeleteContact";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useState } from "react";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContactForm } from "./contact-form";
import { useUpdateContact } from "../hooks/useUpdateContact";
import { formatNames } from "../utils/formatNames";

interface ContactDetailsProps {
    contact: z.infer<typeof LocalContact> | undefined;
    onTransferFunds: (contactId: string) => void;
    onChainMailUser: (contactId: string) => void;
    onBack?: () => void;
}

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

    const { data: profile } = useProfile(contact.account);

    const avatarSrc = useAvatar(contact.account);

    const [primaryName, secondaryName] = formatNames(
        contact.nickname,
        profile?.profile?.displayName,
        contact.account,
    );

    console.log({
        primaryName,
        secondaryName,
        nickname: contact.nickname,
        displayName: profile?.profile?.displayName,
        account: contact.account,
    });

    const { mutate: deleteContact } = useDeleteContact();
    const [showModal, setShowModal] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

    const { mutateAsync: updateContact } = useUpdateContact();

    return (
        <div>
            {onBack && (
                <div className="pl-4">
                    <Button onClick={onBack} variant="outline" size="icon">
                        <ArrowLeft />
                    </Button>
                </div>
            )}
            <Dialog open={showModal} onOpenChange={setShowModal}>
                {isEditing ? (
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Edit contact</DialogTitle>
                            <DialogDescription>
                                <ContactForm
                                    initialValues={contact}
                                    onSubmit={async (data) => {
                                        await updateContact(data);
                                        setShowModal(false);
                                        setIsEditing(false);
                                    }}
                                />
                            </DialogDescription>
                        </DialogHeader>
                    </DialogContent>
                ) : (
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
                                onClick={() => {
                                    deleteContact(contact.account);
                                    setShowModal(false);
                                }}
                            >
                                Confirm
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                )}
            </Dialog>
            <div className="mx-auto flex w-full max-w-screen-md flex-col items-center justify-center gap-4 p-4">
                <div className="flex w-full justify-between">
                    <div className="invisible w-8"></div>
                    <Avatar className="h-32 w-32 rounded-none">
                        <AvatarImage src={avatarSrc} />
                    </Avatar>
                    <div className="flex flex-col items-start">
                        <DropdownMenu>
                            <DropdownMenuTrigger>
                                <Button variant="ghost" size="icon">
                                    <MoreVertical />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                                <DropdownMenuItem
                                    onClick={() => {
                                        setIsEditing(true);
                                        setShowModal(true);
                                    }}
                                >
                                    <Edit className="mr-2 h-4 w-4" />
                                    Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => {
                                        setShowModal(true);
                                        setIsEditing(false);
                                    }}
                                >
                                    <Trash className="mr-2 h-4 w-4" />
                                    Delete
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
                <div className="flex flex-col gap-2 text-center">
                    <div className="text-lg font-medium">{primaryName} </div>
                    {secondaryName && (
                        <div className="flex flex-col gap-1">
                            <div className="text-sm text-muted-foreground">
                                {secondaryName?.toLowerCase()}
                            </div>
                        </div>
                    )}
                    <div className="flex w-full justify-center gap-2 text-muted-foreground ">
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
