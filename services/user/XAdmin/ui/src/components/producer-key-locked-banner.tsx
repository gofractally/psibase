import { Link } from "react-router-dom";

import { useKeyDevices } from "@/hooks/useKeyDevices";
import { useIsProducer } from "@/hooks/useProducers";

import { Alert, AlertDescription, AlertTitle } from "@shared/shadcn/ui/alert";

export const ProducerKeyLockedBanner = () => {
    const isProducer = useIsProducer();
    const { data: keyDevices } = useKeyDevices();

    const thereAreKeyDevices = Boolean(keyDevices?.length);
    const allKeyDevicesLocked = Boolean(
        keyDevices?.every((device) => !device.unlocked),
    );

    if (isProducer && thereAreKeyDevices && allKeyDevicesLocked) {
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
    }

    return null;
};
