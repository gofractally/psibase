import { useEffect, useRef, useState } from "react";

import { PageContainer } from "@shared/components/page-container";
import { Button } from "@shared/shadcn/ui/button";

import { createEmbeddedCheckout, type EmbeddedCheckout } from "../lib/stripe";

/** Stripe Embedded Checkout for a paid signup. `onPaid` runs once payment completes. */
export const PayStep = ({
    clientSecret,
    publishableKey,
    onPaid,
    onBack,
}: {
    clientSecret: string;
    publishableKey: string;
    onPaid: () => void;
    onBack: () => void;
}) => {
    const container = useRef<HTMLDivElement>(null);
    const onPaidRef = useRef(onPaid);
    const [loadFailed, setLoadFailed] = useState(false);

    useEffect(() => {
        onPaidRef.current = onPaid;
    }, [onPaid]);

    useEffect(() => {
        let cancelled = false;
        let checkout: EmbeddedCheckout | undefined;
        createEmbeddedCheckout(publishableKey, clientSecret, () =>
            onPaidRef.current(),
        )
            .then((created) => {
                if (cancelled || !container.current) {
                    created.destroy();
                    return;
                }
                checkout = created;
                created.mount(container.current);
            })
            .catch((error) => {
                console.error("Stripe Checkout failed to load:", error);
                if (!cancelled) setLoadFailed(true);
            });
        return () => {
            cancelled = true;
            checkout?.destroy();
        };
    }, [publishableKey, clientSecret]);

    return (
        <PageContainer className="space-y-6">
            <h2 className="text-lg font-medium">Pay</h2>
            {loadFailed ? (
                <div className="space-y-4">
                    <p className="text-destructive text-sm">
                        Checkout could not be loaded. Please try again later.
                    </p>
                    <div className="flex justify-end">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onBack}
                        >
                            Back
                        </Button>
                    </div>
                </div>
            ) : (
                <div ref={container} />
            )}
        </PageContainer>
    );
};
