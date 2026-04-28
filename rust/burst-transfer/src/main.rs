// cargo build -r --bin burst-transfer --manifest-path rust/Cargo.toml --target-dir build/rust
use std::sync::atomic::AtomicI32;

use anyhow::{anyhow, Context};
use psibase::fracpack::Pack;
use psibase::services::tokens::{Quantity, Wrapper as Tokens};
use psibase::{
    new_account_action, preapprove_action, ActionFormatter, AnyPrivateKey, HttpSchemaFetcher,
    PackageList, TraceFormat,
};

const ACCOUNTS_PER_SETUP: usize = 10;

mod faucet_tok {
    #[psibase::service(name = "faucet-tok", dispatch = false)]
    #[allow(non_snake_case, unused_variables)]
    mod service {
        #[action]
        fn dispense(account: psibase::AccountNumber) {
            unimplemented!()
        }
    }
}

fn parse_api_endpoint(api_str: &str) -> Result<url::Url, anyhow::Error> {
    if let Ok(api_url) = url::Url::parse(api_str) {
        Ok(api_url)
    } else {
        let host_url = psibase::cli::config::read_host_url(api_str)?;
        Ok(url::Url::parse(&host_url)?)
    }
}

/// Randomly push transfers to a blockchain in bursts
#[derive(clap::Parser, Debug)]
#[clap(author, version, about, long_about = None)]
struct Args {
    /// API Endpoint URL or host alias from `psibase config`
    #[clap(
        short = 'a',
        long,
        value_name = "URL_OR_HOST_ALIAS",
        default_value = "http://psibase.localhost:8080/",
        value_parser = parse_api_endpoint
    )]
    api: url::Url,

    /// Sign with this key (repeatable)
    #[clap(short = 's', long, value_name = "KEY")]
    sign: Vec<AnyPrivateKey>,

    /// Token symbol
    #[clap(required = true)]
    symbol: psibase::ExactAccountNumber,

    /// Number of random accounts to create and use as transfer participants
    #[clap(required = true)]
    account_count: usize,

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

    /// Controls how transaction traces are reported. `error` and `stack`
    /// only print failed traces; use `full` or `json` to print successful traces.
    #[clap(long, value_name = "FORMAT", default_value = "stack")]
    trace: TraceFormat,

    /// Controls whether the transaction's console output is shown
    #[clap(long, action=clap::ArgAction::Set, require_equals=true, default_value="true", default_missing_value="true")]
    console: bool,
}

#[derive(Debug, serde::Deserialize)]
struct TokenRecord {
    id: u32,
}

#[derive(Debug, serde::Deserialize)]
struct TokenQuery {
    token: Option<TokenRecord>,
}

async fn lookup_token(
    api: &url::Url,
    symbol_id: &str,
) -> Result<Option<TokenRecord>, anyhow::Error> {
    let token_id = serde_json::to_string(symbol_id)?;
    let body = format!("query {{ token(tokenId: {}) {{ id }} }}", token_id);
    let mut client = reqwest::Client::new();
    Ok(
        psibase::gql_query::<TokenQuery>(api, &mut client, psibase::account!("tokens"), body)
            .await?
            .token,
    )
}

fn random_account_name() -> psibase::AccountNumber {
    let bytes: Vec<u8> = (0..7).map(|_| b'a' + (rand::random::<u8>() % 26)).collect();
    psibase::AccountNumber::from(std::str::from_utf8(&bytes).unwrap())
}

fn account_names(accounts: &[psibase::AccountNumber]) -> String {
    accounts
        .iter()
        .map(|account| account.to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

fn build_transaction(
    actions: Vec<psibase::Action>,
    ref_block: &psibase::TaposRefBlock,
) -> psibase::Transaction {
    let expiration = psibase::TimePointSec::from(chrono::Utc::now() + chrono::Duration::seconds(3));
    psibase::Transaction {
        tapos: psibase::Tapos {
            expiration,
            refBlockSuffix: ref_block.ref_block_suffix,
            flags: 0,
            refBlockIndex: ref_block.ref_block_index,
        },
        actions,
        claims: vec![],
    }
}

async fn push_setup(
    args: &Args,
    new_accounts: &[psibase::AccountNumber],
    ref_block: &psibase::TaposRefBlock,
) -> Result<(), anyhow::Error> {
    let sender = psibase::services::producers::ROOT;
    let mut actions = Vec::new();
    for account in new_accounts {
        if let Some(preapprove) = preapprove_action(sender, *account) {
            actions.push(preapprove);
        }
        actions.push(new_account_action(sender, *account));
    }
    for account in new_accounts {
        actions.push(faucet_tok::Wrapper::pack_from(sender).dispense(*account));
    }

    let trx = build_transaction(actions, ref_block);
    let client = reqwest::Client::new();
    let afmt = ActionFormatter::new(HttpSchemaFetcher {
        client: &client,
        base_url: &args.api,
    });

    psibase::push_transaction(
        &args.api,
        client.clone(),
        psibase::sign_transaction(trx, &args.sign)?.packed(),
        args.trace,
        args.console,
        None,
        &afmt,
    )
    .await
}

async fn transfer_impl(
    args: &Args,
    accounts: &[psibase::AccountNumber],
    token_id: u32,
    counter: &AtomicI32,
    ref_block: &psibase::TaposRefBlock,
) -> Result<(), anyhow::Error> {
    let from = accounts[rand::random::<usize>() % accounts.len()];
    let mut to = from;
    while to == from {
        to = accounts[rand::random::<usize>() % accounts.len()];
    }
    let mut actions = Vec::new();
    for _ in 0..args.actions {
        let memo = format!(
            "memo {}",
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1
        );
        actions.push(Tokens::pack_from(from).credit(
            token_id,
            to,
            Quantity::from(1u64),
            memo.try_into()?,
        ));
    }
    let trx = build_transaction(actions, ref_block);
    let client = reqwest::Client::new();
    let afmt = ActionFormatter::new(HttpSchemaFetcher {
        client: &client,
        base_url: &args.api,
    });

    psibase::push_transaction_optimistic(
        &args.api,
        client.clone(),
        psibase::sign_transaction(trx, &args.sign)?.packed(),
        args.trace,
        args.console,
        None,
        &afmt,
    )
    .await?;
    Ok(())
}

async fn transfer(
    args: &Args,
    accounts: &[psibase::AccountNumber],
    token_id: u32,
    counter: &AtomicI32,
    ref_block: &psibase::TaposRefBlock,
    repeat: bool,
) -> usize {
    loop {
        let transferred = match transfer_impl(args, accounts, token_id, counter, ref_block)
            .await
            .context("Failed to push transaction")
        {
            Ok(()) => true,
            Err(e) => {
                println!("Transfer error | {:?}", e);
                false
            }
        };
        if !repeat {
            return usize::from(transferred);
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    let args = <Args as clap::Parser>::parse();
    if args.account_count < 2 {
        return Err(anyhow!("account_count must be at least 2"));
    }

    let mut client = reqwest::Client::new();
    let installed = PackageList::installed(&args.api, &mut client)
        .await
        .context("Failed to list installed packages")?;
    if !installed.contains_package("FaucetTok") {
        return Err(anyhow!(
            "burst-transfer depends on the FaucetTok package; install it before running"
        ));
    }

    let tok = match lookup_token(&args.api, &args.symbol.to_string())
        .await
        .context("Failed to look up tokens")?
    {
        Some(tok) => tok,
        None => return Err(anyhow!("Can not find tokens with symbol {}", args.symbol)),
    };

    println!(
        "burst-transfer | api: {} | token: {} #{} | accounts: {} | burst: {} tx x {} actions | delay: {}ms",
        args.api, args.symbol, tok.id, args.account_count, args.burst_size, args.actions, args.delay
    );

    let counter = AtomicI32::new(0);
    let mut accounts: Vec<psibase::AccountNumber> = Vec::with_capacity(args.account_count);

    loop {
        let batch_start = tokio::time::Instant::now();
        let ref_block = psibase::get_tapos_for_head(&args.api, reqwest::Client::new())
            .await
            .context("Failed to get tapos");
        match ref_block {
            Err(e) => println!("TAPOS error | {:?}", e),
            Ok(ref_block) => {
                let mut created = 0;
                let mut created_names = String::new();
                let new_accounts = if accounts.len() < args.account_count {
                    let n = std::cmp::min(ACCOUNTS_PER_SETUP, args.account_count - accounts.len());
                    (0..n).map(|_| random_account_name()).collect()
                } else {
                    Vec::new()
                };

                if !new_accounts.is_empty() {
                    match push_setup(&args, &new_accounts, &ref_block)
                        .await
                        .context("Failed to push setup transaction")
                    {
                        Err(e) => println!("Setup error | {:?}", e),
                        Ok(()) => {
                            created = new_accounts.len();
                            created_names = account_names(&new_accounts);
                            accounts.extend(new_accounts);
                        }
                    }
                }

                let mut transferred = 0;
                if accounts.len() >= 2 {
                    let setup_done = accounts.len() >= args.account_count;
                    let repeat = args.delay == 0 && setup_done;
                    let transfer_accounts = accounts.clone();
                    let mut transfers = Vec::new();
                    for _ in 0..args.burst_size {
                        transfers.push(transfer(
                            &args,
                            &transfer_accounts,
                            tok.id,
                            &counter,
                            &ref_block,
                            repeat,
                        ));
                    }
                    if repeat {
                        println!(
                            "Batch | transferred continuously | maintaining {} in-flight transactions",
                            args.burst_size
                        );
                    }
                    transferred = futures::future::join_all(transfers).await.into_iter().sum();
                }

                println!(
                    "Batch | created {} ({}/{}) | transferred {}/{} tx",
                    created,
                    accounts.len(),
                    args.account_count,
                    transferred,
                    args.burst_size
                );
                if !created_names.is_empty() {
                    println!("  {}", created_names);
                }
            }
        }
        if args.delay > 0 {
            let delay = tokio::time::Duration::from_millis(args.delay.into());
            if let Some(remaining) = delay.checked_sub(batch_start.elapsed()) {
                tokio::time::sleep(remaining).await;
            }
        }
    }
}
