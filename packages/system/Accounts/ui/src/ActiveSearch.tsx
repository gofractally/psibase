import { Search } from "lucide-react";

import { Input } from "@shared/shadcn/ui/input";

export const ActiveSearch = ({
    isNoAccounts,
    activeSearch,
    setActiveSearch,
}: {
    isNoAccounts: boolean;
    activeSearch: string;
    setActiveSearch: (activeSearch: string) => void;
}) => (
    <>
        {isNoAccounts ? (
            <div className="text-primary">No accounts available</div>
        ) : (
            <div className="relative mb-3 ml-auto flex-1 md:grow-0">
                <Search className="text-muted-foreground absolute left-2.5 top-2.5 h-4 w-4" />
                <Input
                    value={activeSearch}
                    type="search"
                    onChange={(e) => setActiveSearch(e.target.value)}
                    placeholder="Search..."
                    className="bg-background w-full rounded-lg pl-8 "
                />
            </div>
        )}
    </>
);
