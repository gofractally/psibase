#[psibase::service(name = "de-facto")]
pub mod service {
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

    fn two_thirds_plus_one(count: u8) -> u8 {
        ((count as u16 * 2 + 3) / 3) as u8
    }

    #[action]
    fn role_policy(fractal: AccountNumber, _role_id: u8) -> auth_dyn::policy::DynamicAuthPolicy {
        let accounts: Vec<(AccountNumber, u8)> =
            ::fractals::tables::tables::FractalMemberTable::read()
                .get_index_pk()
                .range((fractal, AccountNumber::new(0))..=(fractal, AccountNumber::new(u64::MAX)))
                .map(|account| (account.account, 1))
                .collect();

        let threshold = two_thirds_plus_one(accounts.len() as u8);
        DynamicAuthPolicy::from_weighted_authorizers(accounts, threshold)
    }
}
