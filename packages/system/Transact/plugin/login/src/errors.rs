use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    ClaimProofMismatch => "Number of proofs does not match number of claims",
}
