export interface Sender {
    name: string;
    email: string;
}

export interface Message {
    id: string;
    subject: string;
    sender: Sender;
    date: string;
    preview: string;
    content: string;
    read: boolean;
}
