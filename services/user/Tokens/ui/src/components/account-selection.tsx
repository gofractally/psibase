import { useConnectedAccounts } from "@/hooks/useConnectedAccounts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useSelectAccount } from "@/hooks/useSelectAccount";
import { useCreateConnectionToken } from "@/hooks/useCreateConnectionToken";
import { useLoggedInUser } from "@/hooks/useLoggedInUser";
import { siblingUrl } from "@psibase/common-lib";
import { Skeleton } from "@/components/ui/skeleton";

export const AccountSelection = () => {
  const { data: availableAccounts } = useConnectedAccounts();

  console.log(siblingUrl(), "sibling url");
  const { mutateAsync: createConnectionToken } = useCreateConnectionToken();
  const { mutateAsync: selectAccount } = useSelectAccount();

  const { data: currentUser, isPending, isFetching } = useLoggedInUser();

  const onAccountSelection = (account: string) => {
    if (account == "-other") {
      createConnectionToken();
    } else {
      selectAccount(account);
    }
  };

  if (isFetching && (isSuccess || isError)) {
    return <Skeleton className="w-full h-[20px] rounded-full" />;
  }
  return (
    <Select
      onValueChange={(account) => {
        onAccountSelection(account);
      }}
      value={currentUser || "A"}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={currentUser || ""} />
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
