import { ComposeDialog, ComposeDialogTrigger } from "./compose-dialog";

export const MailboxHeader = ({ children }: { children: string }) => {
    return (
        <header className="border-border flex shrink-0 items-center justify-between border-b px-4 py-2.5">
            <h1 className="text-xl font-semibold tracking-tight">{children}</h1>
            <ComposeDialog trigger={<ComposeDialogTrigger />} />
        </header>
    );
};

export default MailboxHeader;
