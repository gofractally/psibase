#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::fracpack::Pack;
    use psibase::services::nft as Nft;
    use psibase::*;
    use serde::Deserialize;
    use serde_json::Value;
    use Nft::NftRecord;

    #[derive(Deserialize)]
    struct Response {
        data: Data,
    }

    #[derive(Deserialize)]
    struct Data {
        userNfts: UserNfts,
    }

    #[derive(Deserialize)]
    struct UserNfts {
        edges: Vec<Edge>,
    }

    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct Edge {
        node: NftRecord,
    }

    fn get_nr_nfts(chain: &Chain, user: AccountNumber) -> Result<usize, psibase::Error> {
        let res: Value = chain.graphql(
            Nft::SERVICE,
            &format!(
                r#"
                query UserNfts {{
                    userNfts(user: "{}") {{
                        edges {{
                            node {{
                                id
                                issuer
                                owner
                            }}
                        }}
                    }}
                }}"#,
                user
            ),
        )?;

        let response_root: Response = serde_json::from_value(res)?;
        Ok(response_root.data.userNfts.edges.len())
    }

    #[psibase::test_case(packages("StagedTx", "Nft", "AuthSig"))]
    fn test_propose(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = AccountNumber::from("alice");
        chain.new_account(alice).unwrap();

        let bob = AccountNumber::from("bob");
        chain.new_account(bob).unwrap();

        assert_eq!(get_nr_nfts(&chain, bob)?, 0);

        Wrapper::push_from(&chain, alice)
            .propose(vec![Action {
                sender: bob,
                service: Nft::SERVICE,
                method: MethodNumber::from("mint"),
                rawData: Nft::action_structs::mint {}.packed().into(),
            }])
            .get()?;

        assert_eq!(get_nr_nfts(&chain, bob)?, 1);

        Ok(())
    }
}
