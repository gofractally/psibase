const IMPORTED_PARAM = "imported";

/** Where the host import prompt sends the visitor once the account is imported. */
export const IMPORT_RETURN_PATH = `/?${IMPORTED_PARAM}`;

export const hasReturnedFromImport = () =>
    new URLSearchParams(window.location.search).has(IMPORTED_PARAM);
