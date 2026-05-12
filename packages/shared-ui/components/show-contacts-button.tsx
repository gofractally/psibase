import { Contact } from "lucide-react";
import { useMemo } from "react";

import { siblingUrl } from "@psibase/common-lib";

import { useBranding } from "@shared/hooks/use-branding";
import { useContacts } from "@shared/hooks/use-contacts";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useHasProfilesReadPermission } from "@shared/hooks/use-has-profiles-read-permission";
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

export const ShowContactsButton = () => {
    const { data: networkName } = useBranding();
    const contactsUrl = useMemo(
        () => siblingUrl(null, networkName, "contacts"),
        [networkName],
    );

    const { data: currentUser } = useCurrentUser();
    const { data: hasProfilesReadPermission } = useHasProfilesReadPermission({
        enabled: !!currentUser,
    });
    const { refetch: prompt } = useContacts(currentUser, { enabled: false });

    if (hasProfilesReadPermission === false) {
        return (
            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        aria-label="Enable contacts integration"
                    >
                        <Contact /> Show contacts
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Enable contacts integration?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Enable integration with the{" "}
                            <a href={contactsUrl} target="_blank">
                                Contacts
                            </a>{" "}
                            app to see user nicknames in this app. If you
                            continue, you will be redirected to an authorization
                            prompt.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => prompt()}>
                            Continue
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        );
    }

    return null;
};
