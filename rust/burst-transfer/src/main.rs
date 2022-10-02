use anyhow::{anyhow, Context};
use psibase::fracpack::Packable;

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

    /// Number of transfers in each burst
    #[clap(short = 'b', default_value_t = 1)]
    burst_size: u32,

    /// Delay in milliseconds between each burst
    #[clap(short = 'd', default_value_t = 1000)]
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
    client: reqwest::Client,
    api: &url::Url,
    symbol_id: &str,
) -> Result<Option<TokenRecord>, anyhow::Error> {
    let records = as_json::<Vec<TokenRecord>>(
        client
            .get(get_url(
                api,
                psibase::account!("token-sys"),
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
mod token_sys {
    #[psibase::service(name = "token-sys", dispatch = false)]
    #[allow(non_snake_case, unused_variables, dead_code)]
    mod service {
        #[action]
        fn credit(tokenId: u32, receiver: psibase::AccountNumber, amount: (u64,), memo: (String,)) {
            unimplemented!()
        }
    }
}

// Randomly transfer
async fn transfer_impl(
    client: reqwest::Client,
    args: &Args,
    token_id: u32,
    counter: i32,
) -> Result<(), anyhow::Error> {
    let from = args.accounts[rand::random::<usize>() % args.accounts.len()];
    let mut to = from;
    while to == from {
        to = args.accounts[rand::random::<usize>() % args.accounts.len()];
    }
    let ref_block = psibase::get_tapos_for_head(&args.api, client.clone()).await?;
    let now_plus_10secs = chrono::Utc::now() + chrono::Duration::seconds(10);
    let expiration = psibase::TimePointSec {
        seconds: now_plus_10secs.timestamp() as u32,
    };
    let memo = format!("memo {}", counter);
    println!("{} -> {} {}", from, to, memo);
    let trx = psibase::Transaction {
        tapos: psibase::Tapos {
            expiration,
            refBlockSuffix: ref_block.ref_block_suffix,
            flags: 0,
            refBlockIndex: ref_block.ref_block_index,
        },
        actions: vec![token_sys::Wrapper::pack_from(from.into()).credit(
            token_id,
            to.into(),
            (1u64,),
            (memo,),
        )],
        claims: vec![],
    };
    psibase::push_transaction(
        &args.api,
        client,
        psibase::sign_transaction(trx, &args.sign)?.packed(),
    )
    .await
}

// Print any errors, but continue execution
async fn transfer(client: reqwest::Client, args: &Args, token_id: u32, counter: i32) {
    if let Err(e) = transfer_impl(client, args, token_id, counter)
        .await
        .context("Failed to push transaction")
    {
        println!("\n{:?}", e);
    };
}

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    let args = <Args as clap::Parser>::parse();
    if args.accounts.len() < 2 {
        return Err(anyhow!("Need at least 2 accounts"));
    }

    let tok = match lookup_token(reqwest::Client::new(), &args.api, &args.symbol.to_string())
        .await
        .context("Failed to look up tokens")?
    {
        Some(tok) => tok,
        None => return Err(anyhow!("Can not find tokens with symbol {}", args.symbol)),
    };

    let mut counter = 0;
    loop {
        let mut transfers = Vec::new();
        for _ in 0..args.burst_size {
            transfers.push(transfer(reqwest::Client::new(), &args, tok.id, counter));
            counter += 1;
        }
        futures::future::join_all(transfers).await;
        println!();
        tokio::time::sleep(tokio::time::Duration::from_millis(args.delay.into())).await;
    }
}
