#[psibase::service(name = "de-facto")]
pub mod service {
    use fractals::helpers::two_thirds_plus_one;
    use psibase::{
        services::auth_dyn::{self, policy::DynamicAuthPolicy},
        *,
    };

    #[action]
    fn get_scores(fractal: AccountNumber) -> Vec<(AccountNumber, u32)> {
        ::fractals::tables::tables::FractalMemberTable::read()
            .get_index_pk()
            .range((fractal, AccountNumber::new(0))..=(fractal, AccountNumber::new(u64::MAX)))
            .map(|account| (account.account, 1))
            .collect()
    }

    #[action]
    fn is_active(fractal: AccountNumber, member: AccountNumber) -> bool {
        ::fractals::tables::tables::FractalMemberTable::read()
            .get_index_pk()
            .range((fractal, AccountNumber::new(0))..=(fractal, AccountNumber::new(u64::MAX)))
            .any(|account| account.account == member)
    }

    #[action]
    fn is_supported(fractal: AccountNumber) -> bool {
        ::fractals::tables::tables::FractalTable::read()
            .get_index_pk()
            .get(&fractal)
            .is_some()
    }

    /// Get policy action used by AuthDyn service.
    ///
    /// # Arguments
    /// * `account` - Account being checked.
    #[action]
    fn role_policy(account: AccountNumber) -> auth_dyn::policy::DynamicAuthPolicy {
        // account will be the legislature role account, then we look up the fractal
        // and return the fractal members,

        // ask fractals, what is the fractal for this role account?
        // use a secondary key for now, delete later?
        //

        let accounts: Vec<(AccountNumber, u8)> =
            ::fractals::tables::tables::FractalMemberTable::read()
                .get_index_pk()
                .range((account, AccountNumber::new(0))..=(account, AccountNumber::new(u64::MAX)))
                .map(|account| (account.account, 1))
                .collect();

        DynamicAuthPolicy::from_weighted_authorizers(
            accounts.clone(),
            two_thirds_plus_one(accounts.len() as u8),
        )
    }
}
