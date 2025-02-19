import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  // AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useChainId } from "@/hooks/network/useChainId";
import { useLoggedInUser } from "@/hooks/network/useLoggedInUser";
import { useBalances } from "@/hooks/tokensPlugin/useBalances";
import { createIdenticon } from "@/lib/createIdenticon";
import { Quantity } from "@/lib/quantity";

interface Props {
  open: boolean;
  onContinue: () => void;
  onClose: () => void;
  isPending: boolean;
  title?: string;
  from?: string | null;
  amount?: string;
  tokenId?: number;
  to?: string;
}

export const TransferModal = ({
  open,
  onContinue,
  onClose,
  from,
  to,
  isPending,
  tokenId,
  amount,
}: Props) => {
  const { data } = useChainId();
  const chainId = data || "";

  const { data: currentUserData } = useLoggedInUser();

  const { data: balances } = useBalances(currentUserData);
  const token = balances?.tokens.find((token) => token.id == tokenId);

  const convertedToInteger =
    Number(amount) * Math.pow(10, token?.precision || 0);

  const quantity = token
    ? new Quantity(convertedToInteger.toString(), token.precision, token.id)
    : undefined;

  const numSymbol = quantity ? quantity.format(true).split(" ") : ["", ""];
  const [amountFormatted, symbol] = numSymbol;

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Token transfer</AlertDialogTitle>
          <div className="w-full grid grid-cols-2 gap-2">
            {[
              { label: "From", address: from },
              { label: "To", address: to },
            ].map(({ label, address }) => (
              <div key={label} className="flex flex-col items-center gap-1 ">
                <div className="text-center text-muted-foreground">{label}</div>
                <div>
                  <img
                    className="h-20 w-20   border"
                    src={createIdenticon(chainId + address)}
                  />
                </div>
                <div className="text-center text-lg truncate">{address}</div>
              </div>
            ))}
          </div>
          <div className="text-xl font-semibold text-center w-full flex gap-2 justify-center">
            <span>Sending </span>
            <span>{amountFormatted}</span>
            <span className="text-muted-foreground">{symbol}</span>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onClose()}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction disabled={isPending} onClick={() => onContinue()}>
            {isPending ? "Sending" : "Send"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
