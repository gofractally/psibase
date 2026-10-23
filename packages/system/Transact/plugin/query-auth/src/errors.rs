use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    AccountNotFound(account: &'a str) => "Account not found: {account}",
    ClaimProofMismatch => "Number of proofs does not match number of claims",
    BadResponse(msg: &'a str) => "Bad response: {msg}",
}
