use crate::{
    services::transact, AccountNumber, Action, ActionGroup, ActionSink, SignedTransaction,
    TransactionTrace,
};
use anyhow::Context;
use async_graphql::{InputObject, SimpleObject};
use custom_error::custom_error;
use fracpack::{Pack, UnpackOwned};
use indicatif::ProgressBar;
use reqwest::Url;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::str::FromStr;

custom_error! { Error
    Message{message:String}                         = "{message}",
    ExecutionFailed{message:String}    = "{message}",
    UnknownTraceFormat = "Unknown trace format",
    NoDomain = "Virtual hosting requires a URL with a domain name",
    GraphQLError{message: String} = "{message}",
    GraphQLWrongResponse = "Missing field `data` in graphql response",
    MissingContentType = "HTTP response has no Content-Type",
    WrongContentType{ty:String} = "HTTP response has unexpected Content-Type: {ty}",
}

async fn as_text(builder: reqwest::RequestBuilder) -> Result<String, anyhow::Error> {
    let mut response = builder.send().await?;
    if response.status().is_client_error() {
        response = response.error_for_status()?;
    }
    if response.status().is_server_error() {
        return Err(anyhow::Error::new(Error::Message {
            message: response.text().await?,
        }));
    }
    Ok(response.text().await?)
}

pub async fn as_json<T: DeserializeOwned>(
    builder: reqwest::RequestBuilder,
) -> Result<T, anyhow::Error> {
    Ok(serde_json::de::from_str(&as_text(builder).await?)?)
}

async fn as_json_or_fracpack<T: UnpackOwned + DeserializeOwned>(
    builder: reqwest::RequestBuilder,
) -> Result<T, anyhow::Error> {
    let mut response = builder.send().await?;
    if response.status().is_client_error() {
        response = response.error_for_status()?;
    }
    if response.status().is_server_error() {
        return Err(anyhow::Error::new(Error::Message {
            message: response.text().await?,
        }));
    }
    match response.headers().get("Content-Type") {
        Some(ty) => {
            if ty == "application/json" {
                Ok(serde_json::de::from_str(&response.text().await?)?)
            } else if ty == "application/octet-stream" {
                Ok(T::unpacked(response.bytes().await?.as_ref())?)
            } else {
                Err(Error::WrongContentType {
                    ty: ty.to_str()?.to_string(),
                })?
            }
        }
        None => Err(Error::MissingContentType)?,
    }
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, InputObject)]
#[serde(rename_all = "camelCase")]
#[graphql(input_name = "TaposRefBlockInput")]
pub struct TaposRefBlock {
    pub ref_block_suffix: u32,
    pub ref_block_index: u8,
}

async fn get_tapos_for_head_impl(
    base_url: &Url,
    client: reqwest::Client,
) -> Result<TaposRefBlock, anyhow::Error> {
    as_json(client.get(base_url.join("common/tapos/head")?)).await
}

pub async fn get_tapos_for_head(
    base_url: &Url,
    client: reqwest::Client,
) -> Result<TaposRefBlock, anyhow::Error> {
    get_tapos_for_head_impl(base_url, client)
        .await
        .context("Failed to get tapos for head block")
}

#[derive(Debug, Copy, Clone)]
pub enum TraceFormat {
    Error,
    Stack,
    Full,
    Json,
}

impl TraceFormat {
    pub fn error_for_trace(
        &self,
        trace: TransactionTrace,
        progress: Option<&ProgressBar>,
    ) -> Result<(), anyhow::Error> {
        if let Some(e) = &trace.error {
            if !e.is_empty() {
                let message = match self {
                    TraceFormat::Error => e.to_string(),
                    TraceFormat::Stack => trace.fmt_stack(),
                    TraceFormat::Full => trace.to_string(),
                    TraceFormat::Json => serde_json::to_string(&trace)?,
                };
                Err(Error::ExecutionFailed { message })?;
            }
        }
        match self {
            TraceFormat::Full => progress.suspend(|| print!("{}", trace.to_string())),
            TraceFormat::Json => progress
                .suspend(|| serde_json::to_writer_pretty(std::io::stdout().lock(), &trace))?,
            _ => {}
        }
        Ok(())
    }
}

impl FromStr for TraceFormat {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self, anyhow::Error> {
        match s {
            "error" => Ok(TraceFormat::Error),
            "stack" => Ok(TraceFormat::Stack),
            "full" => Ok(TraceFormat::Full),
            "json" => Ok(TraceFormat::Json),
            _ => Err(Error::UnknownTraceFormat)?,
        }
    }
}

trait OptionProgressBar {
    fn suspend<F: FnOnce() -> R, R>(&self, f: F) -> R;
}

impl OptionProgressBar for Option<&ProgressBar> {
    fn suspend<F: FnOnce() -> R, R>(&self, f: F) -> R {
        if let Some(progress) = self {
            progress.suspend(f)
        } else {
            f()
        }
    }
}

async fn push_transaction_impl(
    base_url: &Url,
    client: reqwest::Client,
    packed: Vec<u8>,
    fmt: TraceFormat,
    console: bool,
    progress: Option<&ProgressBar>,
) -> Result<(), anyhow::Error> {
    let trace: TransactionTrace = as_json_or_fracpack(
        client
            .post(transact::SERVICE.url(base_url)?.join("/push_transaction")?)
            .header("Content-Type", "application/octet-stream")
            .header("Accept", "application/octet-stream")
            .body(packed),
    )
    .await?;
    if console {
        progress.suspend(|| print!("{}", trace.console()));
    }
    fmt.error_for_trace(trace, progress)
}

pub async fn push_transaction(
    base_url: &Url,
    client: reqwest::Client,
    packed: Vec<u8>,
    fmt: TraceFormat,
    console: bool,
    progress: Option<&ProgressBar>,
) -> Result<(), anyhow::Error> {
    push_transaction_impl(base_url, client, packed, fmt, console, progress)
        .await
        .context("Failed to push transaction")?;
    Ok(())
}

pub struct TransactionBuilder<F: Fn(Vec<Action>) -> Result<SignedTransaction, anyhow::Error>> {
    size: usize,
    action_limit: usize,
    actions: Vec<Action>,
    transactions: Vec<(String, Vec<SignedTransaction>, bool)>,
    f: F,
}

impl<F: Fn(Vec<Action>) -> Result<SignedTransaction, anyhow::Error>> TransactionBuilder<F> {
    pub fn new(action_limit: usize, f: F) -> Self {
        TransactionBuilder {
            size: 0,
            action_limit,
            actions: vec![],
            transactions: vec![],
            f,
        }
    }
    pub fn set_label(&mut self, label: String) {
        self.transactions
            .push((label, vec![], !self.actions.is_empty()))
    }
    pub fn push<T: ActionGroup>(&mut self, act: T) -> Result<(), anyhow::Error> {
        act.append_to_tx(&mut self.actions, &mut self.size);
        if self.size >= self.action_limit {
            self.transactions
                .last_mut()
                .unwrap()
                .1
                .push((self.f)(std::mem::take(&mut self.actions))?);
        }
        Ok(())
    }
    pub fn push_all<T: ActionGroup>(&mut self, actions: Vec<T>) -> Result<(), anyhow::Error> {
        for act in actions {
            self.push(act)?;
        }
        Ok(())
    }
    pub fn finish(self) -> Result<Vec<(String, Vec<SignedTransaction>, bool)>, anyhow::Error> {
        let mut result = self.transactions;
        if !self.actions.is_empty() {
            result.last_mut().unwrap().1.push((self.f)(self.actions)?);
        }
        Ok(result)
    }
}

impl<F: Fn(Vec<Action>) -> Result<SignedTransaction, anyhow::Error>> ActionSink
    for TransactionBuilder<F>
{
    fn push_action<T: ActionGroup>(&mut self, act: T) -> Result<(), anyhow::Error> {
        self.push(act)
    }
}

pub async fn push_transactions(
    base_url: &Url,
    client: reqwest::Client,
    transaction_groups: Vec<(String, Vec<SignedTransaction>, bool)>,
    fmt: TraceFormat,
    console: bool,
    progress: &ProgressBar,
) -> Result<(), anyhow::Error> {
    let mut n = 0;
    for (label, transactions, carry) in transaction_groups {
        progress.set_message(label);
        if !carry {
            progress.inc(n);
            n = 0;
        }
        for trx in transactions {
            let result = push_transaction(
                base_url,
                client.clone(),
                trx.packed(),
                fmt,
                console,
                Some(progress),
            )
            .await;

            if let Err(err) = result {
                progress.abandon();
                return Err(err);
            }
            progress.inc(n);
            n = 0;
        }
        n += 1;
    }
    Ok(())
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct GQLError {
    message: String,
}

#[derive(Deserialize)]
struct QueryRoot<T> {
    data: Option<T>,
    errors: Option<GQLError>,
}

pub trait ChainUrl {
    fn url(self, base_url: &reqwest::Url) -> Result<reqwest::Url, anyhow::Error>;
}

impl ChainUrl for AccountNumber {
    fn url(self, base_url: &reqwest::Url) -> Result<reqwest::Url, anyhow::Error> {
        let Some(url::Host::Domain(host)) = base_url.host() else {
            Err(Error::NoDomain)?
        };
        let mut url = base_url.clone();
        url.set_host(Some(&(format!("{}.{}", self, host))))?;
        Ok(url)
    }
}

pub async fn gql_query<T: DeserializeOwned>(
    base_url: &reqwest::Url,
    client: &mut reqwest::Client,
    account: AccountNumber,
    body: String,
) -> Result<T, anyhow::Error> {
    let url = account.url(base_url)?.join("graphql")?;
    let result: QueryRoot<T> = as_json(
        client
            .post(url)
            .header("Content-Type", "application/graphql")
            .body(body),
    )
    .await?;
    if let Some(error) = result.errors {
        Err(Error::GraphQLError {
            message: error.message,
        })?
    }
    let Some(data) = result.data else {
        Err(Error::GraphQLWrongResponse)?
    };
    Ok(data)
}
