#[crate::service(
    name = "eval-hooks",
    actions = "hooks_actions",
    wrapper = "hooks_wrapper",
    structs = "hooks_structs",
    dispatch = false,
    pub_constant = false,
    psibase_mod = "crate"
)]
#[allow(non_snake_case, unused_variables)]
pub mod Hooks {
    use crate::AccountNumber;

    #[action]
    fn on_ev_reg(evaluation_id: u32, account: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn on_ev_unreg(evaluation_id: u32, account: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn on_grp_fin(evaluation_id: u32, group_number: u32, result: Vec<u8>) {
        unimplemented!()
    }

    #[action]
    fn on_attest(evaluation_id: u32, group_number: u32, user: AccountNumber, attestation: Vec<u8>) {
        unimplemented!()
    }

    #[action]
    fn on_eval_fin(evaluation_id: u32) {
        unimplemented!()
    }
}

#[crate::service(
    name = "occupation",
    actions = "occu_actions",
    wrapper = "occu_wrapper",
    structs = "occu_structs",
    dispatch = false,
    pub_constant = false,
    psibase_mod = "crate"
)]
#[allow(non_snake_case, unused_variables)]
pub mod Occupation {
    use crate::{services::auth_dyn, AccountNumber};

    #[action]
    fn get_scores(fractal: AccountNumber) -> Vec<(AccountNumber, u32)> {
        unimplemented!()
    }

    #[action]
    fn is_active(fractal: AccountNumber, member: AccountNumber) -> Option<bool> {
        unimplemented!()
    }

    #[action]
    fn is_role_ok(fractal: AccountNumber, role_id: u8) -> bool {
        unimplemented!()
    }

    #[action]
    fn role_policy(fractal: AccountNumber, role_id: u8) -> auth_dyn::policy::DynamicAuthPolicy {
        unimplemented!()
    }
}

#[crate::service(
    name = "payment",
    actions = "pay_actions",
    wrapper = "pay_wrapper",
    structs = "pay_structs",
    dispatch = false,
    pub_constant = false,
    psibase_mod = "crate"
)]
#[allow(non_snake_case, unused_variables)]
pub mod Payment {
    use crate::{
        services::tokens::{Quantity, TID},
        AccountNumber,
    };

    #[action]
    fn on_payment(fractal: AccountNumber, member: AccountNumber, token_id: TID, amount: Quantity) {
        unimplemented!()
    }

    #[action]
    fn is_supported(fractal: AccountNumber) -> bool {
        unimplemented!()
    }
}

#[crate::service(name = "fractals", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
pub mod Service {
    use crate::services::auth_dyn::policy::DynamicAuthPolicy;
    use crate::services::transact::ServiceMethod;
    use crate::AccountNumber;

    /// Creates a new account and fractal.
    ///
    /// # Arguments
    /// * `fractal_account` - The account number for the new fractal.
    /// * `legislature` - Legislature role account.
    /// * `judiciary` - Judiciary role account.
    /// * `executive` - Executive role account
    /// * `name` - The name of the fractal.
    /// * `mission` - The mission statement of the fractal.
    #[action]
    fn create_frac(
        fractal_account: AccountNumber,
        legislature: AccountNumber,
        judiciary: AccountNumber,
        executive: AccountNumber,
        name: String,
        mission: String,
    ) {
        unimplemented!()
    }

    /// Sets occupation on a fractal role.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `role_id` - Role ID for fractal
    /// * `new_occupation` - New occupation to set for role
    #[action]
    fn set_r_occ(fractal: AccountNumber, role_id: u8, new_occupation: AccountNumber) {
        unimplemented!()
    }

    /// Claim member rewards
    ///
    /// Sends any vested token rewards to the fractal member after applying any pending levies.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    #[action]
    fn claim_rew(fractal: AccountNumber) {
        unimplemented!()
    }

    /// Set ordered occupations
    ///
    /// Payment for each ordered occupation will be according to the fractals payment strategy.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `paid_occupations` - Ordered occupations to set for the fractal
    #[action]
    fn set_paid_occ(fractal: AccountNumber, paid_occupations: Vec<AccountNumber>) {
        unimplemented!()
    }

    /// Set Fractal distribution interval
    ///
    /// # Arguments
    /// * `fractal` - Fractal to update.
    /// * `distribution_interval_secs` - New fractal distribution interval in seconds.
    #[action]
    fn set_dist_int(fractal: AccountNumber, distribution_interval_secs: u32) {
        unimplemented!()
    }

    /// Exile a fractal member.
    ///
    /// Must be called by judiciary.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `member` - The fractal member to be exiled.
    #[action]
    fn exile_member(fractal: AccountNumber, member: AccountNumber) {
        unimplemented!()
    }

    /// Set distribution strategy
    ///
    /// # Arguments
    /// * `fractal` - Fractal to update.
    /// * `distribution_strategy` - Algorithm for weighted distribution.
    #[action]
    fn set_dstrat(fractal: AccountNumber, distribution_strategy: u8) {
        unimplemented!()
    }

    /// Get policy action used by AuthDyn service.
    ///
    /// # Arguments
    /// * `account` - Account being checked.
    /// * `method` - Optional method being checked.
    #[action]
    fn get_policy(account: AccountNumber, method: Option<ServiceMethod>) -> DynamicAuthPolicy {
        unimplemented!()
    }

    /// Has policy action used by AuthDyn service.
    ///
    /// # Arguments
    /// * `account` - Account being checked.
    #[action]
    fn has_policy(account: AccountNumber) -> bool {
        unimplemented!()
    }

    /// Distribute token for a fractal.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    #[action]
    fn dist_token(fractal: AccountNumber) {
        unimplemented!()
    }

    /// Initialise a token for a fractal.
    ///
    /// Called only once per fractal.
    /// Must be called by legislature.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    #[action]
    fn init_token(fractal: AccountNumber) {
        unimplemented!()
    }

    #[event(history)]
    pub fn created_fractal(fractal_account: AccountNumber) {}

    #[event(history)]
    pub fn joined_fractal(fractal_account: AccountNumber, account: AccountNumber) {}
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
