#![allow(non_snake_case)]

#[cfg(test)]
mod tests {

    use p256::ecdsa::Signature;
    use p256::ecdsa::{signature::hazmat::PrehashSigner, SigningKey};
    use p256::pkcs8::DecodePrivateKey;
    use psibase::{
        account,
        fracpack::Pack,
        method_raw,
        services::{
            auth_sig::SubjectPublicKeyInfo,
            credentials, http_server, invite,
            nft::Wrapper as Nft,
            staged_tx,
            tokens::{self, Decimal, Precision, Quantity, Wrapper as Tokens},
            verify_sig,
        },
        tester, AccountNumber, Action, ChainEmptyResult, Claim, MethodNumber, SignedTransaction,
        Transaction,
    };
    use rand::Rng;
    use serde::Deserialize;
    use std::str::FromStr;
    use tester::PRODUCER_ACCOUNT;

    use crate::action_structs::*;
    use crate::Wrapper;

    fn assert_error(result: ChainEmptyResult, message: &str) {
        let err = result.trace.error.unwrap();
        let contains_error = err.contains(message);
        assert!(
            contains_error,
            "Error \"{}\" does not contain: \"{}\"",
            err, message
        );
    }

    #[derive(Deserialize)]
    struct Response<T> {
        data: T,
    }

    #[derive(Deserialize)]
    pub struct BillingConfig {
        pub feeReceiver: String,
    }
    #[derive(Deserialize)]
    struct BillingConfigData {
        getBillingConfig: BillingConfig,
    }

    #[derive(Deserialize)]
    struct ResourcesData {
        userResources: UserResources,
    }

    #[derive(Deserialize)]
    struct UserResources {
        balance: Decimal,
        bufferCapacity: Decimal,
    }

    // Propose a system action
    // Automatically proposed by the producer account on behalf of a system service
    fn propose_sys_action<T: Pack>(
        chain: &psibase::Chain,
        service: AccountNumber,
        method: psibase::MethodNumber,
        action: T,
    ) -> Result<(), psibase::Error> {
        let _ = staged_tx::Wrapper::push_from(chain, PRODUCER_ACCOUNT)
            .propose(
                vec![Action {
                    sender: service,
                    service,
                    method,
                    rawData: action.packed().into(),
                }],
                true,
            )
            .get()?;
        Ok(())
    }

    fn check_balance(
        chain: &psibase::Chain,
        token_id: tokens::TID,
        account: AccountNumber,
        expected_value: u64,
    ) {
        let balance = tokens::Wrapper::push(chain)
            .getBalance(token_id, account)
            .get()
            .unwrap();
        assert!(balance.value == expected_value);
    }

    fn get_billing_config(chain: &psibase::Chain) -> Result<BillingConfig, psibase::Error> {
        let config: serde_json::Value = chain.graphql(
            Wrapper::SERVICE,
            r#"
                query {
                    getBillingConfig {
                        feeReceiver
                    }
                }
            "#,
        )?;

        let response_root: Response<BillingConfigData> = serde_json::from_value(config)?;
        Ok(response_root.data.getBillingConfig)
    }

    fn get_user_resources(
        chain: &psibase::Chain,
        user: AccountNumber,
        auth_token: &str,
    ) -> Result<UserResources, psibase::Error> {
        let balance: serde_json::Value = chain.graphql_auth(
            Wrapper::SERVICE,
            &format!(
                r#"
                    query {{
                        userResources(user: "{}") {{
                            balance
                            bufferCapacity
                        }}
                    }}
                "#,
                user
            ),
            auth_token,
        )?;

        let response: Response<ResourcesData> = serde_json::from_value(balance)?;
        Ok(response.data.userResources)
    }

    #[allow(non_snake_case)]
    #[derive(Deserialize)]
    pub struct GetInviteCostResponse {
        pub getInviteCost: String,
    }

    fn get_invite_cost(
        chain: &psibase::Chain,
        num_accounts: u16,
        auth_token: &str,
    ) -> Result<String, psibase::Error> {
        let invite_cost: serde_json::Value = chain.graphql_auth(
            psibase::services::invite::SERVICE,
            &format!(
                r#"query {{ getInviteCost(numAccounts: {}) }}"#,
                num_accounts
            ),
            auth_token,
        )?;

        let response: Response<GetInviteCostResponse> = serde_json::from_value(invite_cost)?;
        Ok(response.data.getInviteCost)
    }

    // Creates a system token and distributes it to alice and bob
    fn initial_setup(chain: &psibase::Chain) -> Result<(), psibase::Error> {
        let tokens_service = tokens::Wrapper::SERVICE;
        let symbol = account!("symbol");
        let alice = account!("alice");
        let bob = account!("bob");

        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let supply: u64 = 10_000_000_000_000_0000u64.into();
        let sys = tokens::Wrapper::push_from(chain, symbol)
            .create(Precision::new(4).unwrap(), Quantity::from(supply))
            .get()?;

        let nid = Tokens::push(&chain).getToken(sys).get()?.nft_id;
        Nft::push_from(chain, symbol).debit(nid, "".into()).get()?;

        Tokens::push_from(chain, tokens_service)
            .setSysToken(sys)
            .get()?;

        tokens::Wrapper::push_from(chain, symbol)
            .mint(sys, Quantity::from(supply), "".into())
            .get()?;

        tokens::Wrapper::push_from(chain, symbol)
            .credit(sys, alice, 100_000_0000u64.into(), "".into())
            .get()?;

        tokens::Wrapper::push_from(chain, symbol)
            .credit(sys, bob, 100_000_0000u64.into(), "".into())
            .get()?;

        Ok(())
    }

    #[psibase::test_case(packages("VirtualServer", "StagedTx"))]
    fn metering(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let vserver = Wrapper::SERVICE;
        let tokens = tokens::Wrapper::SERVICE;
        let sys: tokens::TID = 1;
        let alice = AccountNumber::from("alice");

        initial_setup(&chain)?;

        let token_prod = chain.login(PRODUCER_ACCOUNT, Wrapper::SERVICE)?;
        let token_a = chain.login(alice, Wrapper::SERVICE)?;

        // This is still needed even though the package config specifies the server...
        http_server::Wrapper::push_from(&chain, vserver)
            .registerServer(vserver)
            .get()?;
        chain.finish_block();

        Wrapper::push(&chain).init().get()?;

        propose_sys_action(
            &chain,
            vserver,
            init_billing::ACTION_NAME.into(),
            init_billing {
                fee_receiver: tokens,
            },
        )?;

        let config = get_billing_config(&chain)?;
        assert!(config.feeReceiver == tokens.to_string());

        let min_resource_buffer = get_user_resources(&chain, PRODUCER_ACCOUNT, &token_prod)?
            .bufferCapacity
            .quantity
            .value;

        check_balance(&chain, sys, PRODUCER_ACCOUNT, 0);

        tokens::Wrapper::push_from(&chain, alice)
            .credit(sys, PRODUCER_ACCOUNT, 10_000_0000.into(), "".into())
            .get()?;

        check_balance(&chain, sys, PRODUCER_ACCOUNT, 10_000_0000);

        // Verify filling resource buffer
        tokens::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
            .credit(sys, vserver, (min_resource_buffer / 2).into(), "".into())
            .get()?;
        assert_error(
            Wrapper::push_from(&chain, PRODUCER_ACCOUNT).buy_res(min_resource_buffer.into()),
            "Insufficient shared balance",
        );
        tokens::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
            .credit(sys, vserver, (min_resource_buffer / 2).into(), "".into())
            .get()?;
        Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
            .buy_res(min_resource_buffer.into())
            .get()?;
        assert_eq!(
            get_user_resources(&chain, PRODUCER_ACCOUNT, &token_prod)?
                .balance
                .quantity
                .value,
            min_resource_buffer
        );

        // Send some more tokens to the producer account
        tokens::Wrapper::push_from(&chain, alice)
            .credit(sys, PRODUCER_ACCOUNT, 10_000_0000.into(), "".into())
            .get()?;

        // Verify enable billing
        propose_sys_action(
            &chain,
            vserver,
            enable_billing::ACTION_NAME.into(),
            enable_billing { enabled: true },
        )?;

        // Verify alice out of resources
        // This shows that alice cannot even buy herself resources
        assert_error(
            tokens::Wrapper::push_from(&chain, alice).credit(
                sys,
                vserver,
                10_0000.into(),
                "".into(),
            ),
            "insufficient resource balance",
        );

        // Producer can buy her some
        tokens::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
            .credit(sys, vserver, min_resource_buffer.into(), "".into())
            .get()?;
        Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
            .buy_res_for(min_resource_buffer.into(), alice, Some("".into()))
            .get()?;
        assert_eq!(
            get_user_resources(&chain, alice, &token_a)?
                .balance
                .quantity
                .value,
            min_resource_buffer
        );

        // Now alice can transact
        tokens::Wrapper::push_from(&chain, alice)
            .credit(sys, vserver, 23_0000.into(), "".into())
            .get()?;

        chain.finish_block();

        let balance = get_user_resources(&chain, alice, &token_a)?
            .balance
            .quantity
            .value;
        assert!(balance < min_resource_buffer.into());

        println!("alice resource balance: {}", balance);

        Ok(())
    }

    fn enable_billing(chain: &psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init().get()?;

        let sys: tokens::TID = 1;
        let alice = account!("alice");
        let vserver = Wrapper::SERVICE;
        let tokens = tokens::Wrapper::SERVICE;
        let token_prod = chain.login(PRODUCER_ACCOUNT, Wrapper::SERVICE)?;

        // This is still needed even though the package config specifies the server...
        http_server::Wrapper::push_from(&chain, vserver)
            .registerServer(vserver)
            .get()?;
        chain.finish_block();

        propose_sys_action(
            &chain,
            vserver,
            init_billing::ACTION_NAME.into(),
            init_billing {
                fee_receiver: tokens,
            },
        )?;

        // Alice give prod some tokens
        tokens::Wrapper::push_from(&chain, alice)
            .credit(sys, PRODUCER_ACCOUNT, 100_000_0000.into(), "".into())
            .get()?;

        let min_resource_buffer = get_user_resources(&chain, PRODUCER_ACCOUNT, &token_prod)?
            .bufferCapacity
            .quantity
            .value;

        tokens::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
            .credit(sys, vserver, min_resource_buffer.into(), "".into())
            .get()?;
        Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
            .buy_res(min_resource_buffer.into())
            .get()?;

        propose_sys_action(
            &chain,
            vserver,
            enable_billing::ACTION_NAME.into(),
            enable_billing { enabled: true },
        )?;

        Ok(())
    }

    #[psibase::test_case(packages("VirtualServer", "StagedTx", "Invite", "Credentials"))]
    fn invites(chain: psibase::Chain) -> Result<(), psibase::Error> {
        //let vserver = Wrapper::SERVICE;
        // let tokens = tokens::Wrapper::SERVICE;
        let invite = invite::Wrapper::SERVICE;
        let sys: tokens::TID = 1;
        // let alice = AccountNumber::from("alice");
        let token_prod = chain.login(PRODUCER_ACCOUNT, Wrapper::SERVICE)?;

        initial_setup(&chain)?;

        http_server::Wrapper::push_from(&chain, invite)
            .registerServer(account!("r-invite"))
            .get()?;
        chain.finish_block();

        enable_billing(&chain)?;

        // Create the invite
        let (public_key, private_key) = psibase::generate_keypair()?;
        let invite_id: u32 = rand::rng().random();
        let min_cost = get_invite_cost(&chain, 1, &token_prod)?;
        let min_cost = Decimal::from_str(&min_cost).unwrap().quantity;
        assert!(min_cost.value > 0, "Cost of an invite should be > 0");

        tokens::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
            .credit(sys, invite, min_cost, "".into())
            .get()?;
        let inv_pubkey_der = pem::parse(public_key.trim())
            .map_err(|e| psibase::Error::new(e))?
            .into_contents();

        let fingerprint = psibase::sha256(&inv_pubkey_der);
        invite::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
            .createInvite(
                invite_id,
                fingerprint,
                1,
                false,
                "".to_string(),
                min_cost.into(),
            )
            .get()?;

        // Create an account using the invite
        let (new_public_key, _new_private_key) = psibase::generate_keypair()?;
        let new_pub_key_der = pem::parse(new_public_key.trim())
            .map_err(|e| psibase::Error::new(e))?
            .into_contents();

        let mut trx = Transaction {
            tapos: Default::default(),
            actions: vec![Action {
                sender: AccountNumber::from(credentials::CREDENTIAL_SENDER),
                service: invite,
                method: MethodNumber::new(method_raw!("createAccount")),
                rawData: (
                    account!("alicealice"),
                    SubjectPublicKeyInfo(new_pub_key_der),
                )
                    .packed()
                    .into(),
            }],
            claims: vec![Claim {
                service: verify_sig::Wrapper::SERVICE,
                rawData: inv_pubkey_der.clone().into(),
            }],
        };
        chain.fill_tapos(&mut trx, 2);
        let tx_packed = trx.packed();
        let signing_key =
            SigningKey::from_pkcs8_pem(&private_key).map_err(|e| psibase::Error::new(e))?;
        let signature: Signature = signing_key
            .sign_prehash(&psibase::sha256(&tx_packed).0)
            .map_err(|e| psibase::Error::new(e))?;
        let strx = SignedTransaction {
            transaction: tx_packed.into(),
            proofs: vec![signature.to_bytes().to_vec().into()],
        };
        let trace = chain.push(&strx);
        if trace.error.is_some() {
            println!("{}", trace.error.unwrap());
            assert!(false, "Invite create acc fail");
        }

        Ok(())
    }
}
