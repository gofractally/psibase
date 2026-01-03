
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription
} from "@shared/shadcn/ui/dialog";



export const DevModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {






    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Dev tools</DialogTitle>
                    <DialogDescription>
                        Make changes to your profile here. Click save when you&apos;re
                        done.
                    </DialogDescription>                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
