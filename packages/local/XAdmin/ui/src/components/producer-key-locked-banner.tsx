import { Link } from "react-router-dom";

import { useServerKeys } from "@/hooks/useKeyDevices";
import { useMyProducer } from "@/hooks/useProducers";

import { Alert, AlertDescription, AlertTitle } from "@shared/shadcn/ui/alert";

export const ProducerKeyLockedBanner = () => {
    const myProducer = useMyProducer();
    const { data: serverKeys } = useServerKeys();

    // if node is not a producer or it doesn't have a signing key, don't show the banner
    if (!myProducer || !myProducer.auth.rawData) return null;

    const isSigningKeyUnlocked = serverKeys?.some(
        (key) => key.rawData === myProducer.auth.rawData,
    );

    // if the signing key is unlocked, don't show the banner
    if (isSigningKeyUnlocked) return null;

    return (
        <Alert variant="destructive">
            <AlertTitle>🔐 Key Device Locked</AlertTitle>
            <AlertDescription>
                <p>
                    Unlock your block signing key device on the{" "}
                    <Link to="/keys-and-devices" className="underline">
                        Keys and Devices
                    </Link>{" "}
                    tab.
                </p>
            </AlertDescription>
        </Alert>
    );
};
