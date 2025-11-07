#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::services::auth_dyn::action_structs::get_policy;
    use psibase::Caller;
    use psibase::{
        check_none, check_some, services::auth_dyn::interfaces::DynamicAuthPolicy, AccountNumber,
        Fracpack, ServiceCaller, Table, ToSchema,
    };
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "PolicyTable", index = 1)]
    #[derive(Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Policy {
        #[primary_key]
        pub account: AccountNumber,
        pub policy: AccountNumber,
    }

    impl Policy {
        #[secondary_key(1)]
        fn by_policy(&self) -> (AccountNumber, AccountNumber) {
            (self.policy, self.account)
        }

        fn new(account: AccountNumber, policy: AccountNumber) -> Self {
            Self { account, policy }
        }

        pub fn get(account: AccountNumber) -> Option<Self> {
            PolicyTable::read().get_index_pk().get(&account)
        }

        pub fn get_assert(account: AccountNumber) -> Self {
            check_some(Self::get(account), "failed to find policy")
        }

        pub fn dynamic_policy(&self) -> DynamicAuthPolicy {
            let service_caller = ServiceCaller {
                flags: 0,
                sender: crate::Wrapper::SERVICE,
                service: self.policy,
            };

            service_caller.call(
                get_policy::ACTION_NAME.into(),
                get_policy {
                    account: self.account,
                },
            )
        }

        pub fn add(account: AccountNumber, policy: AccountNumber) -> Self {
            check_none(Self::get(account), "policy already exists for account");
            let instance = Self::new(account, policy);
            instance.save();
            instance
        }

        fn save(&self) {
            PolicyTable::read_write().put(self).unwrap();
        }
    }
}

#[psibase::service(name = "auth-dyn", tables = "tables")]
pub mod service {
    use crate::tables::{InitRow, InitTable, Policy};
    use psibase::services::auth_dyn::action_structs::get_policy;
    use psibase::services::auth_dyn::interfaces::{DynamicAuthPolicy, WeightedAuthorizer};
    use psibase::services::transact::ServiceMethod;
    use psibase::ServiceCaller;
    use psibase::*;

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::new();
        check(
            table.get_index_pk().get(&()).is_some(),
            "service not inited",
        );
    }

    #[action]
    #[allow(non_snake_case)]
    fn set_policy(policy: AccountNumber) {
        check(
            psibase::services::accounts::Wrapper::call().exists(policy),
            "policy account does not exist",
        );
        Policy::add(get_sender(), policy);
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
    fn isRejectSys(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        auth_set: Option<Vec<AccountNumber>>,
    ) -> bool {
        unimplemented!()
    }

    fn is_auth_other(
        auth_service: AccountNumber,
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        auth_set: Vec<AccountNumber>,
    ) -> bool {
        use psibase::services::auth_delegate::action_structs::isAuthSys;

        ServiceCaller {
            sender: Wrapper::SERVICE,
            service: auth_service,
            flags: 0,
        }
        .call(
            isAuthSys::ACTION_NAME.into(),
            isAuthSys {
                sender,
                authorizers,
                auth_set: Some(auth_set),
            },
        )
    }

    #[action]
    #[allow(non_snake_case)]
    fn isAuthSys(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        auth_set: Option<Vec<AccountNumber>>,
    ) -> bool {
        // Make sure we're not in a loop
        let mut auth_set = auth_set.unwrap_or_default();
        if auth_set.contains(&sender) {
            return false;
        }
        auth_set.push(sender);

        // If we don't have a policy for the sender, we don't have an interest in authorizing anything

        let dynamic_auth_policy = Policy::get_assert(sender).dynamic_policy();

        match dynamic_auth_policy {
            DynamicAuthPolicy::Single(single_auth) => {
                // Here we learn 1 account is specified as an approver, if they have approved in a stagedtx, we personally approve.
                // otherwise, we query their auth service to see if they have approved
                let is_authed = authorizers.contains(&single_auth.authorizer);
                if is_authed {
                    return true;
                } else {
                    let auth_service = psibase::services::accounts::Wrapper::call()
                        .getAuthOf(single_auth.authorizer);

                    return is_auth_other(
                        auth_service,
                        single_auth.authorizer,
                        authorizers,
                        auth_set,
                    );
                }
            }
            DynamicAuthPolicy::Multi(multi_auth) => {
                let threshold = multi_auth.threshold;
                let total_possible_weight = multi_auth
                    .authorizers
                    .iter()
                    .fold(0, |acc, authorizer| acc + authorizer.weight);
                if total_possible_weight < threshold {
                    return false;
                }

                // Quickly see if we can return true based purely from the authorizors and their weights
                let (immediately_approved, not_approved_locally): (
                    Vec<WeightedAuthorizer>,
                    Vec<WeightedAuthorizer>,
                ) = multi_auth
                    .authorizers
                    .into_iter()
                    .partition(|weight_authorizer| {
                        authorizers.contains(&weight_authorizer.account)
                    });

                let immediately_approved_weight = immediately_approved
                    .iter()
                    .fold(0, |acc, vote| acc + vote.weight);

                if immediately_approved_weight >= threshold {
                    return true;
                }

                // here we will do a full check, by checking each authorizer recursively if they haven't already approved
                let mut total_weight_approved = immediately_approved_weight;

                for weight_authorizer in not_approved_locally {
                    let auth_service = psibase::services::accounts::Wrapper::call()
                        .getAuthOf(weight_authorizer.account);

                    let is_auth = is_auth_other(
                        auth_service,
                        weight_authorizer.account,
                        authorizers.clone(),
                        auth_set.clone(),
                    );
                    if is_auth {
                        total_weight_approved += weight_authorizer.weight;
                        if total_weight_approved >= threshold {
                            return true;
                        }
                    }
                }

                false
            }
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn canAuthUserSys(user: AccountNumber) {
        check_some(Policy::get(user), "no policy set for user");
    }

    #[event(history)]
    pub fn updated(old_thing: String, new_thing: String) {}
}

#[cfg(test)]
mod tests;
