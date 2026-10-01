use crate::tables::tables::*;
use async_graphql::ComplexObject;
use psibase::services::producers::Wrapper as Producers;
use psibase::*;

#[ComplexObject]
impl ResourceProvider {
    /// Producer candidate HTTP endpoint (root origin), if registered.
    async fn endpoint(&self) -> Option<String> {
        Producers::call()
            .getCandidate(self.provider)
            .map(|c| c.endpoint)
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

    pub fn register(app: String, accepted: Vec<String>) {
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

        AccountNumber::from_exact(&app).expect("app must be a valid account name");
        assert!(app.starts_with("x-"), "app must start with the x- prefix");
        assert!(
            !accepted.is_empty(),
            "accepted currencies must be non-empty"
        );

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
        let Some(row) = Self::get(sender) else {
            return;
        };
        ResourceProviderTable::read_write().remove(&row);
    }
}
