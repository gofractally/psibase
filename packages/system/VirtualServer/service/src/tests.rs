#![allow(non_snake_case)]

#[cfg(test)]
mod tests {

    use psibase::{
        fracpack::Pack,
        services::{http_server, staged_tx, tokens},
        tester, AccountNumber, Action, ChainEmptyResult,
    };
    use serde::Deserialize;
    use tester::PRODUCER_ACCOUNT;

    use crate::Wrapper;
    use crate::{action_structs::*, tables::tables::*};

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
    struct BillingConfigData {
        getBillingConfig: BillingConfig,
    }

    #[derive(Deserialize)]
    struct Resources {
        value: u64,
    }

    #[derive(Deserialize)]
    struct ResourcesData {
        getResources: Resources,
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
                        sys
                        res
                        feeReceiver
                        minResourceBuffer
                        enabled
                    }
                }
            "#,
        )?;

        let response_root: Response<BillingConfigData> = serde_json::from_value(config)?;
        Ok(response_root.data.getBillingConfig)
    }

    fn get_resource_balance(
        chain: &psibase::Chain,
        user: AccountNumber,
    ) -> Result<u64, psibase::Error> {
        let balance: serde_json::Value = chain.graphql(
            Wrapper::SERVICE,
            &format!(
                r#"
                    query {{
                        getResources(user: "{}") {{
                            value
                        }}
                    }}
                "#,
                user
            ),
        )?;

        let response: Response<ResourcesData> = serde_json::from_value(balance)?;
        Ok(response.data.getResources.value)
    }

    #[psibase::test_case(packages("VirtualServer", "TokenUsers", "StagedTx"))]
    fn metering(chain: psibase::Chain) -> Result<(), psibase::Error> {
        // Depending on TokenUsers so it sets up the system token for me
        let vserver = Wrapper::SERVICE;
        let tokens = tokens::Wrapper::SERVICE;
        let sys: tokens::TID = 1;
        let alice = AccountNumber::from("alice");

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
        assert!(config.fee_receiver == tokens);

        check_balance(&chain, sys, PRODUCER_ACCOUNT, 0);

        tokens::Wrapper::push_from(&chain, alice) // Alice holds tokens from TokenUsers pkg
            .credit(sys, PRODUCER_ACCOUNT, 100_0000.into(), "".into())
            .get()?;

        check_balance(&chain, sys, PRODUCER_ACCOUNT, 100_0000);

        // Verify filling resource buffer
        tokens::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
            .credit(sys, vserver, 5_0000.into(), "".into())
            .get()?;
        assert_error(
            Wrapper::push_from(&chain, PRODUCER_ACCOUNT).refill_res_buf(),
            "Insufficient token balance",
        );
        tokens::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
            .credit(sys, vserver, 5_0000.into(), "".into())
            .get()?;
        Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
            .refill_res_buf()
            .get()?;
        assert_eq!(
            get_resource_balance(&chain, PRODUCER_ACCOUNT)?,
            config.min_resource_buffer
        );

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
            .credit(sys, vserver, 10_0000.into(), "".into())
            .get()?;
        Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
            .buy_res_for(10_0000.into(), alice, Some("".into()))
            .get()?;
        assert_eq!(get_resource_balance(&chain, alice)?, 10_0000);

        // Now alice can transact
        tokens::Wrapper::push_from(&chain, alice)
            .credit(sys, vserver, 10_0000.into(), "".into())
            .get()?;

        Ok(())
    }
}
