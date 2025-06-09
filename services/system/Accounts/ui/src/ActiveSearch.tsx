import { Search } from "lucide-react";
import { Input } from "./components/ui/input";

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
      <div className="relative ml-auto flex-1 md:grow-0 mb-3">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={activeSearch}
          type="search"
          onChange={(e) => setActiveSearch(e.target.value)}
          placeholder="Search..."
          className="w-full rounded-lg bg-background pl-8 "
        />
      </div>
    )}
  </>
);
