import { Inbox, Mail, LoaderCircle } from "lucide-react";

export const EmptyBox = ({ children }: { children: string }) => {
    return (
        <div className="flex h-full select-none flex-col items-center justify-center pb-28 text-gray-300">
            <Inbox size={80} />
            <p className="text-3xl">{children}</p>
        </div>
    );
};

export const LoadingBox = () => {
    return (
        <div className="flex h-full select-none flex-col items-center justify-center pb-28 text-gray-300">
            <LoaderCircle size={80} className="animate-spin" />
        </div>
    );
};

export const NoMessageSelected = ({ children }: { children: string }) => {
    return (
        <div className="flex h-full select-none flex-col items-center justify-center pb-28 text-gray-300">
            <Mail size={80} />
            <p className="text-3xl">{children}</p>
        </div>
    );
};
