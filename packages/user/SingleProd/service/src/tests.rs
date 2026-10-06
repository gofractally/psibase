#[cfg(test)]
mod tests {
    use psibase::services::{
        nft::Wrapper as Nft,
        producers::Wrapper as Producers,
        symbol::Wrapper as Symbol,
        tokens::{Decimal, Precision, Wrapper as Tokens},
        virtual_server::Wrapper as VirtualServer,
    };
    use psibase::*;
    use serde::de::DeserializeOwned;
    use serde::Deserialize;

    fn query<T: DeserializeOwned>(
        chain: &Chain,
        service: AccountNumber,
        field: &str,
        query: &str,
        auth: &str,
    ) -> Result<T, Error> {
        let mut value: serde_json::Value = chain.graphql_auth(service, query, auth)?;
        if let Some(errors) = value
            .get("errors")
            .filter(|errors| errors.as_array().is_some_and(|items| !items.is_empty()))
        {
            return Err(anyhow!("{errors}"));
        }
        Ok(serde_json::from_value(value["data"][field].take())?)
    }

    fn assert_private_network(chain: &Chain) -> Result<(), Error> {
        #[derive(Deserialize)]
        struct ProducerName {
            name: AccountNumber,
        }
        let producers: Vec<ProducerName> = query(
            chain,
            Producers::SERVICE,
            "producers",
            "query { producers { name } }",
            "",
        )?;
        let producer = producers.first().expect("no producer").name;

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Config {
            sys_tid: u32,
        }
        let config: Config = query(
            chain,
            Tokens::SERVICE,
            "config",
            "query { config { sysTid } }",
            "",
        )?;

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct TokenNode {
            id: u32,
            precision: Precision,
            nft_id: u32,
            issued_supply: Decimal,
            max_issued_supply: Decimal,
            settings: TokenSettings,
        }
        #[derive(Deserialize)]
        struct TokenSettings {
            untransferable: bool,
        }
        let token: TokenNode = query(
            chain,
            Tokens::SERVICE,
            "token",
            &format!(
                "query {{ token(tokenId: \"{}\") {{ id precision nftId issuedSupply maxIssuedSupply settings {{ untransferable }} }} }}",
                config.sys_tid
            ),
            "",
        )?;
        assert_eq!(token.id, config.sys_tid);
        assert_eq!(token.precision, Precision::new(4).unwrap());
        assert_eq!(token.max_issued_supply.quantity.value, 21_000_000_000_0000);
        assert_eq!(
            token.issued_supply.quantity.value,
            token.max_issued_supply.quantity.value
        );
        assert!(token.settings.untransferable);

        #[derive(Deserialize)]
        struct SymbolNode {
            mapping: MappingNode,
        }
        #[derive(Deserialize)]
        struct MappingNode {
            #[serde(rename = "tokenId")]
            token_id: u32,
        }
        let symbol: SymbolNode = query(
            chain,
            Symbol::SERVICE,
            "symbol",
            r#"query { symbol(symbol: "psi") { mapping { tokenId } } }"#,
            "",
        )?;
        assert_eq!(symbol.mapping.token_id, token.id);

        #[derive(Deserialize)]
        struct NftNode {
            owner: AccountNode,
            issuer: AccountNode,
        }
        #[derive(Deserialize)]
        struct AccountNode {
            account: AccountNumber,
        }
        let nft: NftNode = query(
            chain,
            Nft::SERVICE,
            "nftDetails",
            &format!(
                "query {{ nftDetails(nftId: {}) {{ owner {{ account }} issuer {{ account }} }} }}",
                token.nft_id
            ),
            "",
        )?;
        assert_eq!(nft.owner.account, producer);
        assert_eq!(nft.issuer.account, Tokens::SERVICE);

        let auth = chain.login(producer, Tokens::SERVICE)?;
        #[derive(Deserialize)]
        struct BalanceNode {
            balance: Decimal,
        }
        let balance: BalanceNode = query(
            chain,
            Tokens::SERVICE,
            "userBalance",
            &format!(
                "query {{ userBalance(user: \"{producer}\", tokenId: \"{}\") {{ balance }} }}",
                token.id
            ),
            &auth,
        )?;
        #[derive(Deserialize)]
        struct Resources {
            balance: Decimal,
        }
        let resources: Resources = query(
            chain,
            VirtualServer::SERVICE,
            "userResources",
            &format!("query {{ userResources(account: \"{producer}\") {{ balance }} }}"),
            &auth,
        )?;
        let held = balance.balance.quantity.value;
        let reserve = resources.balance.quantity.value;
        assert!(reserve > 0);
        assert_eq!(held + reserve, token.max_issued_supply.quantity.value);

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct BillingConfig {
            fee_receiver: AccountNumber,
            enabled: bool,
        }
        let billing: BillingConfig = query(
            chain,
            VirtualServer::SERVICE,
            "getBillingConfig",
            "query { getBillingConfig { feeReceiver enabled } }",
            "",
        )?;
        assert_eq!(billing.fee_receiver, producer);
        assert!(!billing.enabled);

        assert_eq!(Producers::push(chain).getMaxProds().get()?, 3);

        Ok(())
    }

    #[psibase::test_case(packages("SingleProd"))]
    fn sets_up_private_network(chain: Chain) -> Result<(), Error> {
        assert_private_network(&chain)
    }
}
