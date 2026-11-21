// The local development wallet is separate from the chain-hosted application.
// A production host never silently targets a wallet on the visitor's computer.
export function walletApiBase(href) {
  return new URL(href).hostname === 'exchange.psibase.localhost' ? 'http://127.0.0.1:8090' : '';
}
