import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  open: boolean;
  onContinue: () => void;
  onClose: () => void;
  isPending: boolean;
  title?: string;
  from?: string | null;
  to?: string;
}

export const TransferModal = ({
  open,
  onContinue,
  onClose,
  from,
  to,
  isPending,
}: Props) => {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Transfer to {to}</AlertDialogTitle>
          <AlertDialogDescription>{`this is going to ${to} from ${from}`}</AlertDialogDescription>
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
