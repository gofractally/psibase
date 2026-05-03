use crate::abort_message;

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

    /// Get scores for a fractal
    ///
    /// Returns a vector of accounts and their corresponding scores for a fractal.
    /// These scores are used by the Fractals service to determine distribution amounts for each member.
    ///
    /// # Arguments
    /// * `fractal` - The account of the fractal.
    #[action]
    fn get_scores(fractal: AccountNumber) -> Vec<(AccountNumber, u32)> {
        unimplemented!()
    }

    /// Check if a an account is considered active in an occupation
    ///
    /// # Arguments
    /// * `fractal` - The account of the fractal.
    /// * `member` - The member account to check.
    #[action]
    fn is_active(fractal: AccountNumber, member: AccountNumber) -> bool {
        unimplemented!()
    }

    /// Check if a role ID is supported for a fractal.
    ///
    /// Returning false will cause the Fractals service to reject changing a role to this occupation.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `role_id` - Role ID to check.
    #[action]
    fn is_role_ok(fractal: AccountNumber, role_id: u8) -> bool {
        unimplemented!()
    }

    /// Get policy action used by AuthDyn service.
    ///
    /// Returns authorisers for a given role in a fractal.
    ///
    /// # Arguments
    /// * `fractal` - The account of the fractal.
    /// * `role_id` - The role ID to check.
    #[action]
    fn role_policy(fractal: AccountNumber, role_id: u8) -> auth_dyn::policy::DynamicAuthPolicy {
        unimplemented!()
    }
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FractalRole {
    Legislature = 1,
    Judiciary = 2,
    Executive = 3,
    Recruitment = 4,
}

impl From<u8> for FractalRole {
    fn from(value: u8) -> Self {
        match value {
            1 => FractalRole::Legislature,
            2 => FractalRole::Judiciary,
            3 => FractalRole::Executive,
            4 => FractalRole::Recruitment,
            _ => abort_message(&format!("Invalid FractalRole value: {}", value)),
        }
    }
}

impl From<FractalRole> for u8 {
    fn from(value: FractalRole) -> Self {
        value as u8
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
    /// * `recruitment` - Recruitment role account
    /// * `name` - The name of the fractal.
    /// * `mission` - The mission statement of the fractal.
    #[action]
    fn create_frac(
        fractal_account: AccountNumber,
        legislature: AccountNumber,
        judiciary: AccountNumber,
        executive: AccountNumber,
        recruitment: AccountNumber,
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
    /// * `member` - The fractal member claiming rewards.
    #[action]
    fn claim_rew(fractal: AccountNumber, member: AccountNumber) {
        unimplemented!()
    }

    /// Set genesis time for a fractal
    ///
    /// # Arguments
    /// * `fractal` - Fractal to update.
    /// * `genesis_time` - New genesis time for the fractal.
    #[action]
    fn set_gen_time(fractal: AccountNumber, genesis_time: u64) {
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

    /// Add fractal member
    ///
    /// Adds an account to a fractal.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `member` - Account to be added as a member
    /// * `recruiter` - Account of the fractal member that recruited this new member, if applicable.
    #[action]
    fn add_mem(fractal: AccountNumber, member: AccountNumber, recruiter: Option<AccountNumber>) {
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
