// Supports both `<Avatar />` and `<Hexicon />` components.

export type AvaconSize =
    | "xs"
    | "sm"
    | "base"
    | "lg"
    | "xl"
    | "2xl"
    | "3xl"
    | "4xl"
    | "5xl";

export const AVACON_SETTINGS: {
    [key in AvaconSize]: {
        width: number;
        shadowClass: string;
        fontClass: string;
    };
} = {
    xs: {
        width: 20,
        shadowClass: "drop-shadow",
        fontClass: "text-[16px] font-semibold leading-none mt-px",
    },
    sm: {
        width: 24,
        shadowClass: "drop-shadow",
        fontClass: "text-[20px] font-bold leading-none mt-px",
    },
    base: {
        width: 32,
        shadowClass: "drop-shadow",
        fontClass: "text-[24px] font-bold leading-none mt-px",
    },
    lg: {
        width: 40,
        shadowClass: "drop-shadow",
        fontClass: "text-[28px] font-bold leading-none mt-px",
    },
    xl: {
        width: 48,
        shadowClass: "drop-shadow-md",
        fontClass: "text-[32px] font-bold leading-none mt-px",
    },
    "2xl": {
        width: 56,
        shadowClass: "drop-shadow-md",
        fontClass: "text-[36px] font-bold leading-none mt-px",
    },
    "3xl": {
        width: 64,
        shadowClass: "drop-shadow-lg",
        fontClass: "text-[40px] font-bold leading-none mt-px",
    },
    "4xl": {
        width: 96,
        shadowClass: "drop-shadow-lg",
        fontClass: "text-[44px] font-bold leading-none mt-px",
    },
    "5xl": {
        width: 128,
        shadowClass: "drop-shadow-lg",
        fontClass: "text-[52px] font-bold leading-none mt-px",
    },
};
