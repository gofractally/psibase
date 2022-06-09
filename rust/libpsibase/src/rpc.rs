use anyhow::Context;
use custom_error::custom_error;
use reqwest::Url;
use serde_json::Value;

custom_error! { Error
    Message{message:String}                         = "{message}",
    ExecutionFailed{message:String, trace:Value}    = "{message}",
}

async fn push_transaction_impl(
    base_url: &Url,
    client: reqwest::Client,
    packed: Vec<u8>,
) -> Result<(), anyhow::Error> {
    let mut response = client
        .post(base_url.join("native/push_transaction")?)
        .body(packed)
        .send()
        .await?;
    if response.status().is_client_error() {
        response = response.error_for_status()?;
    }
    if response.status().is_server_error() {
        return Err(anyhow::Error::new(Error::Message {
            message: response.text().await?,
        }));
    }
    let text = response.text().await?;
    let trace: Value = serde_json::de::from_str(&text)?;
    // println!("{:#?}", json);
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
