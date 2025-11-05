/** Gets a string message from the error */
export const parseError = (error: unknown): string => {
    if (typeof error === "string") {
        return error;
    } else if (
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof error.message === "string"
    ) {
        return error.message;
    } else {
        console.error("Unrecognised error", error);
        return JSON.stringify(error);
    }
};
