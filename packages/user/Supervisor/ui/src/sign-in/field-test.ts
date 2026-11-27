// A standalone test page (password-field-test.html): which ways of hiding a
// password field a password manager still fills. It only reads the fields of
// its own forms and shows the result; nothing leaves the page.
const VARIANTS: [string, string][] = [
    ["shown", "Shown (the control: this one should always be filled)"],
    ["opacity", "Opacity 0"],
    ["tiny", "1 pixel"],
    ["clip", "Clipped away"],
    ["offscreen", "Off screen"],
    ["overlay", "Covered by another element"],
    ["visibility-hidden", "visibility: hidden"],
    ["display-none", "display: none"],
];

const $ = (id: string) => document.getElementById(id)!;

const SECRET = "Kfield-test-" + Math.random().toString(36).slice(2, 10);

const variants = $("variants");
for (const [how, label] of VARIANTS) {
    const form = document.createElement("form");
    form.autocomplete = "on";
    form.dataset.how = how;
    form.innerHTML = `
        <b></b>
        <input name="username" autocomplete="username" value="field-test" />
        <div class="wrap">
            <input name="password" type="password" autocomplete="current-password" />
            ${how === "overlay" ? '<div class="cover"></div>' : ""}
        </div>
        <button type="submit">Log in</button>
        <div class="result"></div>`;
    form.querySelector("b")!.textContent = label;
    form.addEventListener("submit", (e) => e.preventDefault());
    variants.append(form);
}

const saveForm = $("save") as HTMLFormElement;
const savePassword = saveForm.querySelector<HTMLInputElement>('input[type="password"]')!;
savePassword.value = SECRET;
saveForm.addEventListener("submit", (e) => {
    e.preventDefault();
    // What the sign-in page does to make a manager offer to save: a submit,
    // a same-document navigation, and the form gone from view.
    window.history.replaceState(window.history.state, "", window.location.href);
    saveForm.querySelectorAll("input,button").forEach((el) => ((el as HTMLElement).style.display = "none"));
    $("save-result").textContent = "Submitted. Save it in your password manager, then reload this page.";
});

const autofilled = (input: HTMLInputElement) => {
    try {
        return input.matches(":autofill") || input.matches(":-webkit-autofill");
    } catch {
        return false;
    }
};

$("check").addEventListener("click", () => {
    const lines: string[] = [navigator.userAgent, ""];
    for (const form of variants.querySelectorAll("form")) {
        const input = form.querySelector<HTMLInputElement>('input[type="password"]')!;
        const filled = input.value.length > 0;
        const result = form.querySelector(".result")!;
        result.textContent = filled ? "Filled" : "Not filled";
        result.className = "result " + (filled ? "yes" : "no");
        lines.push(
            `${(form as HTMLFormElement).dataset.how!.padEnd(18)} ${filled ? "filled" : "empty "}  autofill-marked: ${autofilled(input) ? "yes" : "no"}`,
        );
    }
    const summary = $("summary");
    summary.textContent = lines.join("\n");
    summary.hidden = false;
});

$("reload").addEventListener("click", () => window.location.reload());
