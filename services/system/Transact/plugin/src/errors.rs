use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    OnlyAvailableToPlugins(msg: &'a str) => "This functionality is only available to plugins: {msg}",
    InvalidActionName(msg: &'a str) => "Invalid action name: {msg}",
    NotLoggedIn(msg: &'a str) => "Requires a logged-in user: {msg}",
    TransactionError(msg: String) => "Transaction error: {msg}",
    ClaimProofMismatch => "Number of proofs does not match number of claims",
    WrongOrigin(origin: &'a str) => "Cannot be called by {origin}",
}
