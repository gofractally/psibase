use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    NotLoggedIn(msg: &'a str) => "Requires a logged-in user: {msg}",
    TransactionError(msg: String) => "Transaction error: {msg}",
    ClaimProofMismatch => "Number of proofs does not match number of claims",
    BadResponse(msg: &'a str) => "Bad response: {msg}",
}
