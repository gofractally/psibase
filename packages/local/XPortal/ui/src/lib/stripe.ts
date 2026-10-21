/** Stripe requires Stripe.js to load from js.stripe.com, never from a bundle. */
const STRIPE_JS_URL = "https://js.stripe.com/endive/stripe.js";

export type EmbeddedCheckout = {
    mount: (element: HTMLElement) => void;
    destroy: () => void;
};

type StripeJs = {
    createEmbeddedCheckoutPage: (options: {
        fetchClientSecret: () => Promise<string>;
        onComplete?: () => void;
    }) => Promise<EmbeddedCheckout>;
};

declare global {
    interface Window {
        Stripe?: (publishableKey: string) => StripeJs;
    }
}

let stripeJs: Promise<NonNullable<Window["Stripe"]>> | undefined;

const loadStripeJs = () =>
    (stripeJs ??= new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = STRIPE_JS_URL;
        script.onload = () =>
            window.Stripe
                ? resolve(window.Stripe)
                : reject(new Error("Stripe.js did not load"));
        script.onerror = () => {
            stripeJs = undefined;
            reject(new Error("Stripe.js did not load"));
        };
        document.head.appendChild(script);
    }));

/** Creates Embedded Checkout for a Checkout Session; the caller mounts it. */
export const createEmbeddedCheckout = async (
    publishableKey: string,
    clientSecret: string,
    onComplete: () => void,
): Promise<EmbeddedCheckout> => {
    const Stripe = await loadStripeJs();
    return Stripe(publishableKey).createEmbeddedCheckoutPage({
        fetchClientSecret: () => Promise.resolve(clientSecret),
        onComplete,
    });
};
