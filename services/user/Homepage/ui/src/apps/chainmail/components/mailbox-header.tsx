import { ComposeDialog } from "./compose-dialog";

export const MailboxHeader = ({ children }: { children: string }) => {
    return (
        <header className="flex items-center justify-between border-b px-4 py-2.5">
            <div className="flex-1">
                <h1 className="text-xl font-bold">{children}</h1>
            </div>
            <ComposeDialog />
        </header>
    );
};

export default MailboxHeader;
