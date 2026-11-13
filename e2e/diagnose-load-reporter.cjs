/** Temporary CI reporter: dump full Playwright load / top-level errors. */
/** @implements {import('@playwright/test/reporter').Reporter} */
class DiagnoseLoadReporter {
    onError(error) {
        console.error("=== diagnose-load onError ===");
        console.error(JSON.stringify(error, null, 2));
        if (error && error.stack) {
            console.error("--- stack ---");
            console.error(error.stack);
        }
    }

    onStdErr(chunk) {
        const text = chunk.toString();
        if (text.includes("TypeError") || text.includes("Error:")) {
            console.error("=== diagnose-load stderr ===");
            console.error(text);
        }
    }
}

module.exports = DiagnoseLoadReporter;
