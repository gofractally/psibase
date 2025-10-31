import { LoaderCircle } from "lucide-react";

export const Loading = () => {
    return (
        <div className="flex h-full select-none flex-col items-center justify-center pb-[7%] text-gray-300">
            <LoaderCircle size={80} className="animate-spin" />
        </div>
    );
};
