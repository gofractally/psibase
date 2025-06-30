import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@shared/shadcn/ui/alert-dialog";

interface Props {
  open: boolean;
  onContinue: () => void;
  onClose: () => void;
  descriptions: string[];
  isPending: boolean;
  title?: string;
}

export const ConfirmationModal = ({
  open,
  onContinue,
  descriptions,
  onClose,
  title,
  isPending,
}: Props) => (
  <AlertDialog open={open}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {title || "Are you absolutely sure?"}
        </AlertDialogTitle>
        {descriptions.map((description) => (
          <AlertDialogDescription>{description}</AlertDialogDescription>
        ))}
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
)
