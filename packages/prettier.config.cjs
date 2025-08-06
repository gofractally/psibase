module.exports = {
  tabWidth: 4,
  importOrder: [
    "<TS_TYPES>",
    "<BUILTIN_MODULES>",
    "<THIRD_PARTY_MODULES>",
    "^(@psibase/(.*)|@/supervisor)$",
    "^@/pages(/.*)?$",
    "^@/components/ui/(.*)$",
    "^@/components(/.*)?$",
    "^(@/globals|@/hooks|@/lib|@/types|@/utils)(/.*)?$",
    "^@shared(/.*)?$",
    "^[./]",
  ],
  importOrderSeparation: true,
  importOrderSortSpecifiers: true,
  plugins: [
    require.resolve("@trivago/prettier-plugin-sort-imports"),
    require.resolve("prettier-plugin-tailwindcss"),
  ],
};
