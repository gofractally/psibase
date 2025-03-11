export interface Sender {
    name: string;
    email: string;
}

export type Mailbox = "inbox" | "sent" | "drafts" | "archived" | "saved";
