#[crate::service(name = "accounts", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::AccountNumber;
    /// Returns true if the account is a node admin
    #[action]
    fn isAdmin(account: AccountNumber) -> bool {
        unimplemented!()
    }
}
