use psibase::{account, services::producers, tester::PRODUCER_ACCOUNT, Claim, Producer, Push};
use serde::Deserialize;

use crate::Wrapper;

use super::helpers::assert_error;
use super::query;

#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
struct ResourceProviderNode {
    producer: String,
    app: String,
    accepted: Vec<String>,
    endpoint: String,
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
struct ResourceProvidersConnection {
    edges: Vec<ResourceProviderEdge>,
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
struct ResourceProviderEdge {
    node: ResourceProviderNode,
}

fn resource_providers(chain: &psibase::Chain) -> Result<Vec<ResourceProviderNode>, psibase::Error> {
    let conn: ResourceProvidersConnection = query::query_field(
        chain,
        Wrapper::SERVICE,
        "resourceProviders",
        r#"query {
            resourceProviders {
                edges {
                    node {
                        producer
                        app
                        accepted
                        endpoint
                    }
                }
            }
        }"#,
    )?;
    Ok(conn.edges.into_iter().map(|e| e.node).collect())
}

#[psibase::test_case(packages("VirtualServer", "StagedTx"))]
fn register_and_query_resource_provider(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let producers = producers::SERVICE;
    let auth = Claim::default();

    producers::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
        .regCandidate("https://prod.example.com".into(), auth.clone())
        .get()?;

    Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
        .reg_res_provider("x-portal".into(), vec!["USD".into(), "EUR".into()])
        .get()?;

    let providers = resource_providers(&chain)?;
    assert_eq!(providers.len(), 1);
    assert_eq!(providers[0].producer, PRODUCER_ACCOUNT.to_string());
    assert_eq!(providers[0].app, "x-portal");
    assert_eq!(providers[0].accepted, vec!["USD", "EUR"]);
    assert_eq!(providers[0].endpoint, "https://prod.example.com");

    // Update (upsert)
    Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
        .reg_res_provider("x-portal".into(), vec!["GBP".into()])
        .get()?;
    let providers = resource_providers(&chain)?;
    assert_eq!(providers[0].accepted, vec!["GBP"]);

    // Unregister
    Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
        .unreg_res_provider()
        .get()?;
    assert!(resource_providers(&chain)?.is_empty());

    // Non-producer cannot register
    let alice = account!("alice");
    chain.new_account(alice)?;
    producers::Wrapper::push_from(&chain, alice)
        .regCandidate("https://alice.example.com".into(), auth)
        .get()?;
    assert_error(
        Wrapper::push_from(&chain, alice).reg_res_provider("x-portal".into(), vec!["USD".into()]),
        "only active producers",
    );

    // Inactive producer is filtered from the query but can still unregister
    chain.new_account(account!("prod2"))?;
    producers::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
        .regCandidate("https://prod.example.com".into(), Claim::default())
        .get()?;
    Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
        .reg_res_provider("x-portal".into(), vec!["USD".into()])
        .get()?;
    assert_eq!(resource_providers(&chain)?.len(), 1);

    producers::Wrapper::push_from(&chain, producers)
        .setProducers(vec![Producer {
            name: account!("prod2"),
            auth: Claim::default(),
        }])
        .get()?;
    // Consensus updates land on `current` after several blocks (see Producers tests).
    chain.finish_block();
    chain.start_block();
    chain.start_block();
    chain.start_block();

    let active = producers::Wrapper::push(&chain).getProducers().get()?;
    assert!(
        !active.contains(&PRODUCER_ACCOUNT),
        "expected producer rotation; still active: {active:?}"
    );
    assert!(
        resource_providers(&chain)?.is_empty(),
        "inactive producers must be filtered from resourceProviders"
    );

    Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
        .unreg_res_provider()
        .get()?;

    Ok(())
}
