import { useMediaQuery } from "usehooks-ts";

/** Matches Contacts and Tailwind `lg` for two-column mailbox layout. */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");
