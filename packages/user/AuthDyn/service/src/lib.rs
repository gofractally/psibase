#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::services::auth_dyn::action_structs::get_policy;
    use psibase::{check, get_sender, Caller};
    use psibase::{
        check_some, services::auth_dyn::interfaces::DynamicAuthPolicy, AccountNumber, Fracpack,
        ServiceCaller, Table, ToSchema,
    };
    use serde::{Deserialize, Serialize};

    #[table(name = "PolicyTable", index = 0)]
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

        pub fn set(account: AccountNumber, policy: AccountNumber) -> Self {
            let sender = get_sender();
            let existing_policy = Self::get(account);
            if let Some(existing_policy) = existing_policy {
                check(
                    sender == existing_policy.policy,
                    "existing policies can only be updated by policy account",
                )
            } else {
                check(
                    sender == policy || sender == account,
                    "new policies can only be created by the policy account or user",
                );
            }
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
    use crate::tables::Policy;
    use psibase::services::accounts::Wrapper as Accounts;
    use psibase::services::auth_dyn::interfaces::{DynamicAuthPolicy, WeightedAuthorizer};
    use psibase::services::transact::ServiceMethod;
    use psibase::ServiceCaller;
    use psibase::*;

    #[action]
    #[allow(non_snake_case)]
    fn set_policy(account: AccountNumber, policy: AccountNumber) {
        check(
            psibase::services::accounts::Wrapper::call().exists(policy),
            "policy account does not exist",
        );
        Policy::set(account, policy);
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
        is_auth(sender, authorizers, auth_set, false)
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

    fn is_auth(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        auth_set: Option<Vec<AccountNumber>>,
        is_approval: bool,
    ) -> bool {
        // Make sure we're not in a loop
        let mut auth_set = auth_set.unwrap_or_default();
        if auth_set.contains(&sender) {
            return false;
        }
        auth_set.push(sender);

        let dynamic_auth_policy = Policy::get_assert(sender).dynamic_policy();

        match dynamic_auth_policy {
            DynamicAuthPolicy::Single(single_auth) => {
                // Here we learn 1 account is specified as an approver, if they have approved in a stagedtx, we personally approve.
                // otherwise, we query their auth service to see if they have approved
                if authorizers.contains(&single_auth.authorizer) {
                    return true;
                } else {
                    let auth_service = Accounts::call().getAuthOf(single_auth.authorizer);

                    return is_auth_other(
                        auth_service,
                        single_auth.authorizer,
                        authorizers,
                        auth_set,
                    );
                }
            }
            DynamicAuthPolicy::Multi(mut multi_auth) => {
                check(
                    multi_auth.threshold != 0,
                    "multi auth threshold cannot be 0",
                );

                let total_possible_weight = multi_auth
                    .authorizers
                    .iter()
                    .fold(0, |acc, authorizer| acc + authorizer.weight);
                if total_possible_weight < multi_auth.threshold {
                    return false;
                }

                // Move any multi_auth.authorizers to the front if found in authorizers
                multi_auth
                    .authorizers
                    .sort_by_key(|wa| !authorizers.contains(&wa.account));

                let mut total_weight_approved = 0;

                for weight_authorizer in multi_auth.authorizers {
                    let is_auth = authorizers.contains(&weight_authorizer.account)
                        || is_auth_other(
                            Accounts::call().getAuthOf(weight_authorizer.account),
                            weight_authorizer.account,
                            authorizers.clone(),
                            auth_set.clone(),
                        );
                    if is_auth {
                        total_weight_approved += weight_authorizer.weight;
                        if total_weight_approved >= multi_auth.threshold {
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
    fn isAuthSys(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        auth_set: Option<Vec<AccountNumber>>,
    ) -> bool {
        is_auth(sender, authorizers, auth_set, true)
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
