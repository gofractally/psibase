use std::sync::atomic::AtomicI32;

use anyhow::{anyhow, Context};
use psibase::fracpack::Pack;

/// Randomly push transfers to a blockchain in bursts
#[derive(clap::Parser, Debug)]
#[clap(author, version, about, long_about = None)]
struct Args {
    /// API Endpoint
    #[clap(
        short = 'a',
        long,
        value_name = "URL",
        default_value = "http://psibase.127.0.0.1.sslip.io:8080/"
    )]
    api: url::Url,

    /// Sign with this key (repeatable)
    #[clap(short = 's', long, value_name = "KEY")]
    sign: Vec<psibase::PrivateKey>,

    /// Token symbol
    #[clap(required = true)]
    symbol: psibase::ExactAccountNumber,

    /// Accounts to transfer between; need at least 2
    #[clap(required = true)]
    accounts: Vec<psibase::ExactAccountNumber>,

    /// Number of transactions in each burst
    #[clap(short = 'b', long, default_value_t = 1)]
    burst_size: u32,

    /// Number of transfer actions in each transaction
    #[clap(short = 'A', long, default_value_t = 1)]
    actions: u32,

    /// Delay in milliseconds between each burst. If this is 0, then
    /// maintain <BURST_SIZE> transactions in flight.
    #[clap(short = 'd', long, default_value_t = 1000)]
    delay: u32,
}

// Get the url for a service's path
fn get_url(
    api: &url::Url,
    service: psibase::AccountNumber,
    path: &str,
) -> Result<url::Url, anyhow::Error> {
    let host = match api
        .host()
        .ok_or_else(|| anyhow!("missing host name in <API>"))?
    {
        url::Host::Domain(s) => s,
        _ => return Err(anyhow!("missing host name in <API>")),
    };
    let mut api = api.clone();
    api.set_host(Some(&(service.to_string() + "." + host)))?;
    api.set_path(path);
    Ok(api)
}

// Get response as text
async fn as_text(mut response: reqwest::Response) -> Result<String, anyhow::Error> {
    if response.status().is_client_error() {
        response = response.error_for_status()?;
    }
    if response.status().is_server_error() {
        return Err(anyhow!("{}", response.text().await?));
    }
    Ok(response.text().await?)
}

// Get response as JSON
async fn as_json<T: serde::de::DeserializeOwned>(
    response: reqwest::Response,
) -> Result<T, anyhow::Error> {
    Ok(serde_json::de::from_str(&as_text(response).await?)?)
}

// Just the fields we care about
#[allow(non_snake_case)]
#[derive(Debug, serde::Deserialize)]
struct TokenRecord {
    id: u32,
    symbolId: String,
}

// Look up token ID
async fn lookup_token(
    api: &url::Url,
    symbol_id: &str,
) -> Result<Option<TokenRecord>, anyhow::Error> {
    let records = as_json::<Vec<TokenRecord>>(
        reqwest::Client::new()
            .get(get_url(
                api,
                psibase::account!("tokens"),
                "/api/getTokenTypes",
            )?)
            .send()
            .await?,
    )
    .await?;

    for record in records {
        if record.symbolId == symbol_id {
            return Ok(Some(record));
        }
    }

    Ok(None)
}

// Interface to the action we need
mod tokens {
    #[psibase::service(name = "tokens", dispatch = false)]
    #[allow(non_snake_case, unused_variables)]
    mod service {
        #[action]
        fn credit(tokenId: u32, receiver: psibase::AccountNumber, amount: (u64,), memo: (String,)) {
            unimplemented!()
        }
    }
}

// Randomly transfer
async fn transfer_impl(
    args: &Args,
    token_id: u32,
    counter: &AtomicI32,
    ref_block: &psibase::TaposRefBlock,
) -> Result<(), anyhow::Error> {
    let from = args.accounts[rand::random::<usize>() % args.accounts.len()];
    let mut to = from;
    while to == from {
        to = args.accounts[rand::random::<usize>() % args.accounts.len()];
    }
    let now_plus_10secs = chrono::Utc::now() + chrono::Duration::seconds(10);
    let expiration = psibase::TimePointSec {
        seconds: now_plus_10secs.timestamp() as u32,
    };
    let mut actions = Vec::new();
    for _ in 0..args.actions {
        let memo = format!(
            "memo {}",
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1
        );
        // println!("{} -> {} {}", from, to, memo);
        actions.push(tokens::Wrapper::pack_from(from.into()).credit(
            token_id,
            to.into(),
            (1u64,),
            (memo,),
        ));
    }
    let trx = psibase::Transaction {
        tapos: psibase::Tapos {
            expiration,
            refBlockSuffix: ref_block.ref_block_suffix,
            flags: 0,
            refBlockIndex: ref_block.ref_block_index,
        },
        actions,
        claims: vec![],
    };
    psibase::push_transaction(
        &args.api,
        reqwest::Client::new(),
        psibase::sign_transaction(trx, &args.sign)?.packed(),
    )
    .await?;
    Ok(())
}

// Print any errors, but continue execution
async fn transfer(
    args: &Args,
    token_id: u32,
    counter: &AtomicI32,
    ref_block: &psibase::TaposRefBlock,
    repeat: bool,
) {
    loop {
        if let Err(e) = transfer_impl(args, token_id, counter, ref_block)
            .await
            .context("Failed to push transaction")
        {
            println!("\n{:?}", e);
        };
        if !repeat {
            return;
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    let args = <Args as clap::Parser>::parse();
    if args.accounts.len() < 2 {
        return Err(anyhow!("Need at least 2 accounts"));
    }

    let tok = match lookup_token(&args.api, &args.symbol.to_string())
        .await
        .context("Failed to look up tokens")?
    {
        Some(tok) => tok,
        None => return Err(anyhow!("Can not find tokens with symbol {}", args.symbol)),
    };

    let counter = AtomicI32::new(0);
    loop {
        println!("get tapos");
        let ref_block = psibase::get_tapos_for_head(&args.api, reqwest::Client::new())
            .await
            .context("Failed to push transaction");
        println!("got tapos");
        match ref_block {
            Err(e) => println!("\n{:?}", e),
            Ok(ref_block) => {
                let mut transfers = Vec::new();
                for _ in 0..args.burst_size {
                    transfers.push(transfer(
                        &args,
                        tok.id,
                        &counter,
                        &ref_block,
                        args.delay == 0,
                    ));
                }
                futures::future::join_all(transfers).await;
            }
        }
        if args.delay > 0 {
            println!("sleep...");
            tokio::time::sleep(tokio::time::Duration::from_millis(args.delay.into())).await;
        }
        println!("ready");
    }
}
