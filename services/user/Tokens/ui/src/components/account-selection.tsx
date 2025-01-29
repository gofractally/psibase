import { useConnectedAccounts } from "@/hooks/network/useConnectedAccounts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useSelectAccount } from "@/hooks/network/useSelectAccount";
import { useCreateConnectionToken } from "@/hooks/network/useCreateConnectionToken";
import { useLoggedInUser } from "@/hooks/network/useLoggedInUser";
import { Skeleton } from "@/components/ui/skeleton";

export const AccountSelection = () => {
  const { data: availableAccounts, isFetched: isAvailableAccountsFetched } =
    useConnectedAccounts();

  const { data: currentUser, isFetched: isLoggedInUserFetched } =
    useLoggedInUser();

  const { mutateAsync: createConnectionToken } = useCreateConnectionToken();
  const { mutateAsync: selectAccount } = useSelectAccount();

  const onAccountSelection = (account: string) => {
    if (account == "-other") {
      createConnectionToken();
    } else {
      selectAccount(account);
    }
  };

  const isLoading = !(isAvailableAccountsFetched && isLoggedInUserFetched);

  if (isLoading) {
    return <Skeleton className="w-full h-[40px] rounded-full" />;
  }
  return (
    <Select
      onValueChange={(account) => {
        onAccountSelection(account);
      }}
      value={currentUser || "A"}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={currentUser || "No account selected"} />
      </SelectTrigger>
      <SelectContent>
        {availableAccounts.map((account) => (
          <SelectItem key={account} value={account}>
            {account}
          </SelectItem>
        ))}
        <SelectItem value={"-other"}>Other...</SelectItem>
      </SelectContent>
    </Select>
  );
};
