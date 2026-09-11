use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    TransactionError(msg: String) => "Transaction error: {msg}",
    ClaimProofMismatch => "Number of proofs does not match number of claims",
    BadResponse(msg: &'a str) => "Bad response: {msg}",
}
