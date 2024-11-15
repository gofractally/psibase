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
import { PackageInfo } from "@/types";

interface Props {
    show: boolean;
    removingPackage?: PackageInfo;
    dependencies: PackageInfo[];
    onResponse: (confirmed: boolean) => void;
}

export const DependencyDialog = ({
    dependencies,
    removingPackage,
    show,
    onResponse,
}: Props) => (
    <AlertDialog open={show}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>
                    {removingPackage?.name} is a dependency.
                </AlertDialogTitle>
                <AlertDialogDescription>
                    {dependencies.length > 1 ? "Packages" : "Package"}{" "}
                    {dependencies.map((pack, index, arr) => {
                        const isLast = arr.length == index + 1;
                        return (
                            <span key={pack.sha256} className="text-primary">
                                {pack.name}
                                {isLast ? " " : ", "}
                            </span>
                        );
                    })}
                    depends on{" "}
                    <span className="text-primary">
                        {removingPackage?.name}
                    </span>
                    .
                </AlertDialogDescription>
                <AlertDialogDescription>
                    Are you sure you wish to remove?
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel
                    onClick={() => {
                        onResponse(false);
                    }}
                >
                    Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                    onClick={() => {
                        onResponse(true);
                    }}
                >
                    Continue
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
);
