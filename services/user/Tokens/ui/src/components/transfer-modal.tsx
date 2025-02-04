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
          <div className="w-full  flex justify-around">
            <div className="flex flex-col gap-1">
              <div className="text-center text-muted-foreground">From</div>
              <div>
                <img
                  className="h-20 w-20 rounded-none"
                  src={createIdenticon(chainId + from)}
                />
              </div>
              <div className="text-center text-lg">{from}</div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-center text-muted-foreground">To</div>
              <div className="w-full justify-center">
                <img
                  className="h-20 w-20 rounded-none"
                  src={createIdenticon(chainId + to)}
                />
              </div>
              <div className="text-center text-lg">{to}</div>
            </div>
          </div>
          <div className="text-xl font-semibold text-center w-full flex gap-2 justify-center">
            <span>{amountFormatted} </span>
            <span className="text-muted-foreground">{symbol} </span>
          </div>{" "}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onClose()}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction disabled={isPending} onClick={() => onContinue()}>
            {isPending ? "Loading" : "Continue"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
