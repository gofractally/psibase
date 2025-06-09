import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "./components/ui/input";
import { AccountType } from "./types";

export const ActiveSearch = ({
  accounts,
  setAccountsToRender,
}: {
  accounts: AccountType[];
  setAccountsToRender: (accounts: AccountType[]) => void;
}) => {
  const [activeSearch, setActiveSearch] = useState("");
  const isNoAccounts = accounts ? accounts.length == 0 : false;
  const handleSetActiveSearch = (activeSearch: string) => {
    setActiveSearch(activeSearch);
    setAccountsToRender(
      activeSearch
        ? (accounts || []).filter((account) =>
            account.account.toLowerCase().includes(activeSearch.toLowerCase())
          )
        : accounts || []
    );
  };

  return (
    <>
      {isNoAccounts ? (
        <div className="text-primary">No accounts available</div>
      ) : (
        <div className="relative ml-auto flex-1 md:grow-0 mb-3">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={activeSearch}
            type="search"
            onChange={(e) => handleSetActiveSearch(e.target.value)}
            placeholder="Search..."
            className="w-full rounded-lg bg-background pl-8 "
          />
        </div>
      )}
    </>
  );
};
