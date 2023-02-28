const messagingServerURL = import.meta.env.VITE_MESSAGING_SERVER as string;
const isProduction = import.meta.env.PROD as boolean;
const isSsr = import.meta.env.SSR as boolean;

if (!messagingServerURL) alert("VITE MESSAGING SERVER is falsy");

export const config = {
    messagingServerURL,
    isProduction,
    isSsr,
};
