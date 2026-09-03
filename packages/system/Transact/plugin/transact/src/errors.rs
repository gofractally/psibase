use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    InvalidActionName(msg: &'a str) => "Invalid action name: {msg}",
    NotLoggedIn(msg: &'a str) => "Requires a logged-in user: {msg}",
    ClaimProofMismatch => "Number of proofs does not match number of claims",
}
