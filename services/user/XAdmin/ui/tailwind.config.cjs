const colors = require("tailwindcss/colors");
const defaultTheme = require("tailwindcss/defaultTheme");
const formReset = require("@tailwindcss/forms");

module.exports = {
    content: [
        "./src/**/*.{js,ts,jsx,tsx}",
        "../../packages/components/src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: "media",
    theme: {
        boxShadow: {
            ...defaultTheme.boxShadow,
            sm: "0px 1px 1px rgba(15, 23, 42, 0.05)",
            DEFAULT:
                "0px 1px 3px rgba(15, 23, 42, 0.1), 0px 1px 2px rgba(15, 23, 42, 0.1)",
            md: "0px 4px 6px rgba(15, 23, 42, 0.1), 0px 2px 4px rgba(15, 23, 42, 0.1)",
            lg: "0px 10px 15px rgba(15, 23, 42, 0.1), 0px 4px 6px rgba(15, 23, 42, 0.1)",
            xl: "0px 20px 25px rgba(15, 23, 42, 0.1), 0px 8px 10px rgba(15, 23, 42, 0.1)",
            "2xl": "0px 25px 50px rgba(15, 23, 42, 0.25)",
        },
        colors: {
            inherit: "inherit",
            current: "currentColor",
            transparent: "transparent",
            black: colors.black,
            white: colors.white,
            gray: colors.slate,
            red: colors.rose,
            orange: colors.amber,
            green: colors.emerald,
            blue: {
                50: "#F5F8FD",
                100: "#D6E2F5",
                200: "#B6CBEE",
                300: "#97B5E6",
                400: "#789FDF",
                500: "#316CCC",
                600: "#2756A3",
                700: "#1D417A",
                800: "#142B52",
                900: "#0A1629",
            },
        },
        fontFamily: {
            ...defaultTheme.fontFamily,
            sans: ["Raleway", "sans-serif"],
            mono: ["Red Hat Mono", "monospace"],
            emoji: [
                "Apple Color Emoji",
                "Segoe UI Emoji",
                "Noto Color Emoji",
                "Android Emoji",
                "EmojiSymbols",
                "EmojiOne Mozilla",
                "Twemoji Mozilla",
                "Segoe UI Symbol",
            ],
        },
        fontSize: {
            ...defaultTheme.fontSize,
            xs: ["0.75rem", { lineHeight: "1.25rem" }],
            "3xl": [
                "1.75rem",
                { lineHeight: "2.25rem", letterSpacing: "-0.02em" },
            ],
            "4xl": ["2rem", { lineHeight: "2.5rem", letterSpacing: "-0.02em" }],
            "5xl": [
                "2.25rem",
                { lineHeight: "2.75rem", letterSpacing: "-0.02em" },
            ],
            "6xl": ["2.5rem", { lineHeight: "3rem", letterSpacing: "-0.02em" }],
            "7xl": "3rem",
            "8xl": "3.75rem",
            "9xl": "4.5rem",
        },
        screens: {
            xs: "475px",
            ...defaultTheme.screens,
        },
    },
    variants: {
        extend: {
            margin: ["last"],
            backgroundColor: ["active"],
            width: ["focus-within"],
        },
    },
    plugins: [formReset],
};
