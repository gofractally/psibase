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
            .get(&(fractal, member))
            .is_some()
    }

    #[action]
    fn is_role_ok(fractal: AccountNumber, _role_id: u8) -> bool {
        ::fractals::tables::tables::FractalTable::read()
            .get_index_pk()
            .get(&fractal)
            .is_some()
    }

    /// Get policy action used by AuthDyn service.
    ///
    /// # Arguments
    /// * `role_account` - Account being checked.
    #[action]
    fn role_policy(
        role_account: AccountNumber,
        _role_id: u8,
    ) -> auth_dyn::policy::DynamicAuthPolicy {
        let fractal = check_some(
            psibase::services::fractals::Wrapper::call().frac_by_role(role_account),
            "expected fractal from role account",
        );

        let accounts: Vec<(AccountNumber, u8)> =
            ::fractals::tables::tables::FractalMemberTable::read()
                .get_index_pk()
                .range((fractal, AccountNumber::new(0))..=(fractal, AccountNumber::new(u64::MAX)))
                .map(|account| (account.account, 1))
                .collect();

        DynamicAuthPolicy::from_weighted_authorizers(
            accounts.clone(),
            two_thirds_plus_one(accounts.len() as u8),
        )
    }
}
