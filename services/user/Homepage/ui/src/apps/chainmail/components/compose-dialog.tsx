import { useState } from "react";
import { Send, SquarePen, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";

export function ComposeDialog() {
    const [open, setOpen] = useState(false);
    const [recipient, setRecipient] = useState("");
    const [subject, setSubject] = useState("");
    const [message, setMessage] = useState("");

    const handleSend = () => {
        console.log({ recipient, subject, message });
        resetForm();
        setOpen(false);
    };

    const resetForm = () => {
        setRecipient("");
        setSubject("");
        setMessage("");
    };

    const handleClose = () => {
        resetForm();
        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <DialogTrigger asChild>
                        <Button variant="ghost" size="icon">
                            <SquarePen className="h-5 w-5" />
                            <span className="sr-only">Compose</span>
                        </Button>
                    </DialogTrigger>
                </TooltipTrigger>
                <TooltipContent>Compose</TooltipContent>
            </Tooltip>
            <DialogContent className="flex h-[100dvh] max-w-full flex-col rounded-none px-4 py-8 sm:grid sm:h-auto sm:max-w-[600px] sm:p-6">
                <DialogHeader>
                    <DialogTitle>Compose New Message</DialogTitle>
                    <DialogDescription>
                        Send a message to other accounts on chain. This is for
                        demo purposes only. All messages are stored on chain
                        unencrypted and are publicly readable.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-grow flex-col gap-4 py-4 sm:grid">
                    <Input
                        id="recipient"
                        placeholder="Recipient account name"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        aria-label="Recipient"
                    />
                    <Input
                        id="subject"
                        placeholder="Subject"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        aria-label="Subject"
                    />
                    <Textarea
                        id="message"
                        placeholder="Message"
                        className="flex-1 sm:min-h-[200px]"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        aria-label="Message"
                    />
                </div>
                <DialogFooter className="flex flex-col-reverse gap-2 pb-4 sm:flex-row sm:justify-between sm:space-x-2 sm:pb-0">
                    <Button
                        variant="outline"
                        onClick={handleClose}
                        className="w-full sm:w-auto"
                    >
                        <X className="mr-2 h-4 w-4" />
                        Cancel
                    </Button>
                    <Button onClick={handleSend} className="w-full sm:w-auto">
                        <Send className="mr-2 h-4 w-4" />
                        Send Message
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default ComposeDialog;
