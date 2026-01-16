#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::services::auth_dyn::int_wrapper;
    use psibase::services::transact::ServiceMethod;
    use psibase::{
        check, check_some, services::auth_dyn::policy::DynamicAuthPolicy, AccountNumber, Fracpack,
        Table, ToSchema,
    };
    use serde::{Deserialize, Serialize};

    #[table(name = "ManagementTable", index = 0)]
    #[derive(Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Management {
        #[primary_key]
        pub account: AccountNumber,
        pub manager: AccountNumber,
    }

    impl Management {
        #[secondary_key(1)]
        fn by_manager(&self) -> (AccountNumber, AccountNumber) {
            (self.manager, self.account)
        }

        fn new(account: AccountNumber, manager: AccountNumber) -> Self {
            Self { account, manager }
        }

        pub fn get(account: AccountNumber) -> Option<Self> {
            ManagementTable::read().get_index_pk().get(&account)
        }

        pub fn get_assert(account: AccountNumber) -> Self {
            check_some(Self::get(account), "failed to find management")
        }

        pub fn has_policy(&self) -> bool {
            int_wrapper::call_to(self.manager).has_policy(self.account)
        }

        pub fn dynamic_policy(&self, service_method: Option<ServiceMethod>) -> DynamicAuthPolicy {
            int_wrapper::call_to(self.manager).get_policy(self.account, service_method)
        }

        pub fn set(account: AccountNumber, policy: AccountNumber) -> Self {
            let instance = Self::new(account, policy);
            instance.save();
            instance
        }

        pub fn assert_has_policy(&self) {
            check(
                self.has_policy(),
                "management service does not support user",
            )
        }

        fn save(&self) {
            ManagementTable::read_write().put(self).unwrap();
        }
    }
}

#[psibase::service(name = "auth-dyn", tables = "tables", recursive = true)]
pub mod service {
    use crate::tables::Management;
    use psibase::services::accounts::Wrapper as Accounts;
    use psibase::services::auth_dyn::policy::WeightedAuthorizer;
    use psibase::services::transact::ServiceMethod;
    use psibase::*;

    #[action]
    #[allow(non_snake_case)]
    fn newAccount(account: AccountNumber) {
        if let Some(management) = Management::get(account) {
            // Idempotency safety: if management already exists, only the current
            // manager may call this again — prevents other callers from being
            // misled into thinking they now manage the account.
            check(
                management.manager == get_sender(),
                "new manager conflicts with pre-existing manager",
            );
        } else {
            Management::set(account, get_sender());
            Accounts::call().newAccount(account, Wrapper::SERVICE, true);
        }
    }

    #[action]
    fn set_mgmt(account: AccountNumber, manager: AccountNumber) {
        check(Accounts::call().exists(account), "account does not exist");

        let sender = get_sender();
        let existing_management = Management::get(account);
        if let Some(existing_management) = existing_management {
            check(
                sender == existing_management.manager,
                "existing managements must be updated by management account",
            )
        } else {
            check(
                Accounts::call().exists(manager),
                "manager account does not exist",
            );
            check(
                sender == account,
                "new policies must be created by user account",
            );
        }

        let management = Management::set(account, manager);
        management.assert_has_policy();
    }

    #[action]
    #[allow(non_snake_case)]
    fn checkAuthSys(
        _flags: u32,
        _requester: AccountNumber,
        _sender: AccountNumber,
        _action: ServiceMethod,
        _allowedActions: Vec<ServiceMethod>,
        _claims: Vec<Claim>,
    ) {
        abort_message("This account can only be exercised through staged transactions.")
    }

    #[action]
    #[allow(non_snake_case)]
    fn isAuthSys(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        method: Option<ServiceMethod>,
        authSet: Option<Vec<AccountNumber>>,
    ) -> bool {
        is_auth(sender, authorizers, method, authSet, true)
    }

    #[action]
    #[allow(non_snake_case)]
    fn isRejectSys(
        sender: AccountNumber,
        rejecters: Vec<AccountNumber>,
        method: Option<ServiceMethod>,
        authSet: Option<Vec<AccountNumber>>,
    ) -> bool {
        is_auth(sender, rejecters, method, authSet, false)
    }

    fn is_auth_other(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        auth_set: Vec<AccountNumber>,
        is_approval: bool,
    ) -> bool {
        use psibase::services::transact::auth_interface::AuthWrapper;

        let auth_service = AuthWrapper::call_to(Accounts::call().getAuthOf(sender));

        if is_approval {
            auth_service.isAuthSys(sender, authorizers, None, Some(auth_set))
        } else {
            auth_service.isRejectSys(sender, authorizers, None, Some(auth_set))
        }
    }

    fn is_auth(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        method: Option<ServiceMethod>,
        auth_set: Option<Vec<AccountNumber>>,
        is_approval: bool,
    ) -> bool {
        // Make sure we're not in a loop
        let mut auth_set = auth_set.unwrap_or_default();
        if auth_set.contains(&sender) {
            return false;
        }
        auth_set.push(sender);

        let policy = Management::get_assert(sender).dynamic_policy(method);
        check(policy.threshold != 0, "multi auth threshold cannot be 0");

        let total_possible_weight = policy
            .authorizers
            .iter()
            .fold(0, |acc, authorizer| acc + authorizer.weight);

        if policy.threshold > total_possible_weight {
            return !is_approval;
        }

        let required_weight = if is_approval {
            policy.threshold
        } else {
            total_possible_weight - policy.threshold + 1
        };

        let (already_approved, to_check): (Vec<WeightedAuthorizer>, Vec<WeightedAuthorizer>) =
            policy
                .authorizers
                .into_iter()
                .partition(|authorizer| authorizers.contains(&authorizer.account));

        let mut total_weight_approved = already_approved
            .into_iter()
            .fold(0, |acc, authorizer| authorizer.weight + acc);

        if total_weight_approved >= required_weight {
            return true;
        }

        for weight_authorizer in to_check {
            let is_auth = is_auth_other(
                weight_authorizer.account,
                authorizers.clone(),
                auth_set.clone(),
                is_approval,
            );
            if is_auth {
                total_weight_approved += weight_authorizer.weight;
                if total_weight_approved >= required_weight {
                    return true;
                }
            }
        }

        false
    }

    #[action]
    #[allow(non_snake_case)]
    fn canAuthUserSys(user: AccountNumber) {
        let management = check_some(Management::get(user), "no manager set for user");
        management.assert_has_policy();
    }
}
