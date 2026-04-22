import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Button } from '@shared/shadcn/ui/button';
import { useInitToken } from "@/hooks/fractals/use-init-token";

export const InitTokenModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const { mutateAsync: intialiseToken, isPending: isLoading } = useInitToken();

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Initialise fractal token</DialogTitle>
                </DialogHeader>
                <Button disabled={isLoading} onClick={() => { intialiseToken([]) }}>
                    Init token
                </Button>
            </DialogContent>
        </Dialog>
    );
};
