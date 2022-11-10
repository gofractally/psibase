use anyhow::Context;
use async_graphql::{InputObject, SimpleObject};
use custom_error::custom_error;
use reqwest::Url;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;

custom_error! { Error
    Message{message:String}                         = "{message}",
    ExecutionFailed{message:String, trace:Value}    = "{message}",
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

async fn as_json<T: DeserializeOwned>(
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

async fn push_transaction_impl(
    base_url: &Url,
    client: reqwest::Client,
    packed: Vec<u8>,
) -> Result<(), anyhow::Error> {
    let trace: Value = as_json(
        client
            .post(base_url.join("native/push_transaction")?)
            .body(packed),
    )
    .await?;
    // println!("{:#?}", trace);
    let err = trace.get("error").and_then(|v| v.as_str());
    if let Some(e) = err {
        if !e.is_empty() {
            return Err(Error::ExecutionFailed {
                message: e.to_string(),
                trace,
            }
            .into());
        }
    }
    Ok(())
}

pub async fn push_transaction(
    base_url: &Url,
    client: reqwest::Client,
    packed: Vec<u8>,
) -> Result<(), anyhow::Error> {
    push_transaction_impl(base_url, client, packed)
        .await
        .context("Failed to push transaction")?;
    Ok(())
}
