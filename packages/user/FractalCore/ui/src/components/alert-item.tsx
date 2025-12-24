import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@shared/shadcn/ui/alert-dialog";
import { Button } from "@shared/shadcn/ui/button";
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle,
} from "@shared/shadcn/ui/item";

type AlertItemProps = {
    title: string;
    description: string;
    confirmTitle: string;
    confirmDescription: string | React.ReactNode;
    buttonText: string;
    onConfirm: () => void;
    isPending?: boolean;
    variant?: "outline" | "destructive";
};

export const AlertItem = ({
    title,
    description,
    confirmTitle,
    confirmDescription,
    buttonText,
    onConfirm,
    isPending = false,
    variant = "outline",
}: AlertItemProps) => {
    return (
        <Item variant="outline">
            <ItemContent>
                <ItemTitle>{title}</ItemTitle>
                <ItemDescription>{description}</ItemDescription>
            </ItemContent>
            <ItemActions>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button
                            variant={variant}
                            size="sm"
                            disabled={isPending}
                        >
                            {buttonText}
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
                            <AlertDialogDescription>
                                {confirmDescription}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={onConfirm}>
                                {buttonText}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </ItemActions>
        </Item>
    );
};
