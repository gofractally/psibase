#![allow(non_snake_case)]

#[cfg(test)]
mod tests {

    use psibase::{
        account,
        fracpack::Pack,
        services::{
            http_server,
            nft::Wrapper as Nft,
            staged_tx,
            tokens::{self, Precision, Quantity, Wrapper as Tokens},
        },
        tester, AccountNumber, Action, ChainEmptyResult,
    };
    use serde::Deserialize;
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
    pub struct BillingConfigWithBuffer {
        pub feeReceiver: String,
        pub minResourceBuffer: u64,
    }
    #[derive(Deserialize)]
    struct BillingConfigData {
        getBillingConfig: BillingConfigWithBuffer,
    }

    #[derive(Deserialize)]
    struct ResourcesData {
        userResources: UserResources,
    }

    #[derive(Deserialize)]
    struct UserResources {
        balanceRaw: u64,
    }

    #[derive(Deserialize)]
    struct CpuPricingData {
        cpuPricing: Option<CpuPricing>,
    }

    #[derive(Deserialize)]
    struct CpuPricing {
        availableUnits: u64,
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

    fn get_billing_config(
        chain: &psibase::Chain,
    ) -> Result<BillingConfigWithBuffer, psibase::Error> {
        let config: serde_json::Value = chain.graphql(
            Wrapper::SERVICE,
            r#"
                query {
                    getBillingConfig {
                        feeReceiver
                        minResourceBuffer
                    }
                }
            "#,
        )?;

        let response_root: Response<BillingConfigData> = serde_json::from_value(config)?;
        Ok(response_root.data.getBillingConfig)
    }

    fn get_cpu_pricing(chain: &psibase::Chain) -> Result<CpuPricing, psibase::Error> {
        let pricing: serde_json::Value = chain.graphql(
            Wrapper::SERVICE,
            r#"
                query {
                    cpuPricing {
                        availableUnits
                    }
                }
            "#,
        )?;

        let response_root: Response<CpuPricingData> = serde_json::from_value(pricing)?;
        response_root
            .data
            .cpuPricing
            .ok_or_else(|| psibase::anyhow!("CPU pricing not initialized"))
    }

    fn get_resource_balance(
        chain: &psibase::Chain,
        user: AccountNumber,
        auth_token: &str,
    ) -> Result<u64, psibase::Error> {
        let balance: serde_json::Value = chain.graphql_auth(
            Wrapper::SERVICE,
            &format!(
                r#"
                    query {{
                        userResources(user: "{}") {{
                            balanceRaw
                        }}
                    }}
                "#,
                user
            ),
            auth_token,
        )?;

        let response: Response<ResourcesData> = serde_json::from_value(balance)?;
        Ok(response.data.userResources.balanceRaw)
    }

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
        let min_resource_buffer = config.minResourceBuffer;

        check_balance(&chain, sys, PRODUCER_ACCOUNT, 0);

        tokens::Wrapper::push_from(&chain, alice)
            .credit(sys, PRODUCER_ACCOUNT, 10_000_0000.into(), "".into())
            .get()?;

        check_balance(&chain, sys, PRODUCER_ACCOUNT, 10_000_0000);

        // Verify filling resource buffer
        tokens::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
            .credit(sys, vserver, 5_000_0000.into(), "".into())
            .get()?;
        assert_error(
            Wrapper::push_from(&chain, PRODUCER_ACCOUNT).buy_res(min_resource_buffer.into()),
            "Insufficient shared balance",
        );
        tokens::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
            .credit(sys, vserver, 5_000_0000.into(), "".into())
            .get()?;
        Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
            .buy_res(min_resource_buffer.into())
            .get()?;
        let cpu_pricing = get_cpu_pricing(&chain)?;
        assert_eq!(
            get_resource_balance(&chain, PRODUCER_ACCOUNT, &token_prod)?,
            min_resource_buffer - cpu_pricing.availableUnits // Price is always 1 at the start, so we
                                                             // can just subtract the available units
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
            get_resource_balance(&chain, alice, &token_a)?,
            min_resource_buffer - cpu_pricing.availableUnits
        );

        // Now alice can transact
        tokens::Wrapper::push_from(&chain, alice)
            .credit(sys, vserver, 23_0000.into(), "".into())
            .get()?;

        chain.finish_block();

        let balance = get_resource_balance(&chain, alice, &token_a)?;
        assert!(balance < min_resource_buffer.into());

        println!("alice resource balance: {}", balance);

        Ok(())
    }
}
