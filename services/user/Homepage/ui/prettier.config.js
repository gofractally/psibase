module.exports = {
    tabWidth: 4,
    importOrder: [
        "<TS_TYPES>",
        "<BUILTIN_MODULES>",
        "<THIRD_PARTY_MODULES>",
        "^(@psibase/(.*)|@/supervisor)$",
        "^@/components/ui/(.*)$",
        "^@/components/(.*)$",
        "^(@/hooks|@/lib|@/types|@/utils)(/.*)$",
        "^@/apps/(.*)$",
        "^[./]",
    ],
    importOrderSeparation: true,
    importOrderSortSpecifiers: true,
    plugins: [
        "@trivago/prettier-plugin-sort-imports",
        "prettier-plugin-tailwindcss",
    ],
};
