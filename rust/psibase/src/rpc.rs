use crate::TransactionTrace;
use anyhow::Context;
use async_graphql::{InputObject, SimpleObject};
use custom_error::custom_error;
use reqwest::Url;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::str::FromStr;

custom_error! { Error
    Message{message:String}                         = "{message}",
    ExecutionFailed{message:String}    = "{message}",
    UnknownTraceFormat = "Unknown trace format"
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
    Message,
    Stack,
    Full,
    Json,
}

impl TraceFormat {
    pub fn error_for_trace(&self, trace: TransactionTrace) -> Result<(), anyhow::Error> {
        if let Some(e) = &trace.error {
            if !e.is_empty() {
                let message = match self {
                    TraceFormat::Message => e.to_string(),
                    TraceFormat::Stack => trace.fmt_stack(),
                    TraceFormat::Full => trace.to_string(),
                    TraceFormat::Json => serde_json::to_string(&trace)?,
                };
                Err(Error::ExecutionFailed { message })?;
            }
        }
        Ok(())
    }
}

impl FromStr for TraceFormat {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self, anyhow::Error> {
        match s {
            "message" => Ok(TraceFormat::Message),
            "stack" => Ok(TraceFormat::Stack),
            "full" => Ok(TraceFormat::Full),
            "json" => Ok(TraceFormat::Json),
            _ => Err(Error::UnknownTraceFormat)?,
        }
    }
}

async fn push_transaction_impl(
    base_url: &Url,
    client: reqwest::Client,
    packed: Vec<u8>,
    fmt: TraceFormat,
) -> Result<(), anyhow::Error> {
    let trace: TransactionTrace = as_json(
        client
            .post(base_url.join("native/push_transaction")?)
            .body(packed),
    )
    .await?;
    fmt.error_for_trace(trace)
}

pub async fn push_transaction(
    base_url: &Url,
    client: reqwest::Client,
    packed: Vec<u8>,
    fmt: TraceFormat,
) -> Result<(), anyhow::Error> {
    push_transaction_impl(base_url, client, packed, fmt)
        .await
        .context("Failed to push transaction")?;
    Ok(())
}
