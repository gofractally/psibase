use crate::tables::tables::*;
use async_graphql::ComplexObject;
use psibase::services::producers::Wrapper as Producers;
use psibase::*;

#[ComplexObject]
impl ResourceProvider {
    /// Payment-portal origin: the producer's candidate endpoint with this
    /// provider's app account as a subdomain (e.g. `https://x-portal.prod.example.com`).
    async fn endpoint(&self) -> Option<String> {
        let candidate = Producers::call().getCandidate(self.provider)?;
        let mut url = url::Url::parse(&candidate.endpoint).ok()?;
        let host = url.host_str()?.to_string();
        url.set_host(Some(&format!("{}.{}", self.app, host))).ok()?;
        Some(url.origin().ascii_serialization())
    }

    /// Whether this producer is currently in the active producer set.
    async fn active_infra_provider(&self) -> bool {
        Producers::call()
            .getProducers()
            .into_iter()
            .any(|p| p == self.provider)
    }
}

impl ResourceProvider {
    pub fn get(provider: AccountNumber) -> Option<Self> {
        ResourceProviderTable::read().get_index_pk().get(&provider)
    }

    pub fn register(app: AccountNumber, accepted: Vec<String>) {
        let sender = get_sender();
        let producers = Producers::call().getProducers();
        assert!(
            producers.contains(&sender),
            "only active producers may register as a resource provider"
        );

        let candidate = Producers::call()
            .getCandidate(sender)
            .expect("producer must be registered as a candidate");
        assert!(
            !candidate.endpoint.is_empty(),
            "candidate endpoint must be non-empty"
        );

        assert!(
            app.to_string().starts_with("x-"),
            "app must start with the x- prefix"
        );
        assert!(
            !accepted.is_empty(),
            "accepted currencies must be non-empty"
        );
        let accepted: Vec<String> = accepted
            .into_iter()
            .map(|code| {
                let lower = code.to_ascii_lowercase();
                assert!(
                    !lower.is_empty() && lower.chars().count() <= 6,
                    "currency name invalid: {code}"
                );
                lower
            })
            .collect();

        ResourceProviderTable::read_write()
            .put(&ResourceProvider {
                provider: sender,
                app,
                accepted,
            })
            .unwrap();
    }

    pub fn unregister() {
        let sender = get_sender();
        ResourceProviderTable::read_write().erase(&sender);
    }
}
