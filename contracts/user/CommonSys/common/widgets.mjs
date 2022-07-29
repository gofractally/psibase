export function SubmitButton(title, callback) {
  return html`<button class="ui primary button" onClick=${callback}>${title}</button>`;
}
