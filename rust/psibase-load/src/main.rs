// psibase-load: a load generator that is not the bottleneck.
//
//   cargo build -r --bin psibase-load --manifest-path rust/Cargo.toml --target-dir build/rust
//
// Two modes, one JSON line of results on stdout per run:
//
//   push  Prepares signed token transfers ahead of time (real signatures,
//         each transaction unique), then pushes them over keep-alive HTTP
//         connections, as fast as the node answers or at a fixed offered
//         rate. Transactions are prepared in batches, each with the tapos
//         and expiration of the moment it is prepared, so a run can last
//         as long as it likes; only the time spent pushing is counted.
//   get   Repeats one cheap query.
//
// The node answers a push when the transaction has been applied (or is
// final), never before: push_transaction has no mode that does not wait.
// So the number of transactions in flight is the number of connections,
// and the throughput a run can reach is bounded by
// connections / (time to be applied). Use enough connections.
//
// See tests/timing/usage_metering.py for a complete run against a node.
use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context};
use psibase::services::tokens::{Quantity, Wrapper as Tokens};
use psibase::{AnyPrivateKey, ServiceWrapper};

#[derive(clap::ValueEnum, Clone, Copy, Debug, PartialEq)]
enum Mode {
    Push,
    Get,
}

#[derive(clap::ValueEnum, Clone, Copy, Debug, PartialEq)]
enum WaitFor {
    Applied,
    Final,
}

/// Push prepared signed transfers, or repeat a query, and report throughput and latency
#[derive(clap::Parser, Debug)]
#[clap(author, version, about, long_about = None)]
struct Args {
    /// The node's root URL, e.g. http://psibase.localhost:8080/
    #[clap(short = 'a', long, value_name = "URL", default_value = "http://psibase.localhost:8080/")]
    api: url::Url,

    /// Connect to this address whatever the host names in the URL resolve to
    #[clap(long, value_name = "IP:PORT")]
    connect: Option<SocketAddr>,

    #[clap(long, value_enum, default_value = "push")]
    mode: Mode,

    /// Number of requests
    #[clap(short = 'n', long, default_value_t = 1000)]
    count: usize,

    /// Number of keep-alive connections (requests in flight)
    #[clap(short = 'c', long, default_value_t = 64)]
    connections: usize,

    /// Offered requests per second. 0: as fast as the node answers
    #[clap(short = 'r', long, default_value_t = 0.0)]
    rate: f64,

    /// Send `Authorization: Bearer <TOKEN>`: run the load as a logged-in account
    #[clap(long, value_name = "TOKEN")]
    token: Option<String>,

    /// An additional request header, `Name: value` (repeatable)
    #[clap(short = 'H', long = "header", value_name = "HEADER")]
    headers: Vec<String>,

    /// push: when the node answers
    #[clap(long, value_enum, default_value = "applied")]
    wait_for: WaitFor,

    /// push: the account that sends the transfers (repeatable; all sign with --sign)
    #[clap(long, value_name = "ACCOUNT", value_parser = psibase::AccountNumber::from_exact)]
    from: Vec<psibase::AccountNumber>,

    /// push: the account that receives the transfers
    #[clap(long, value_name = "ACCOUNT", default_value = "bob", value_parser = psibase::AccountNumber::from_exact)]
    to: psibase::AccountNumber,

    /// push: sign with this key (a PKCS #8 PEM file; repeatable). Without it
    /// the transactions are unsigned and no signature is verified
    #[clap(short = 's', long, value_name = "KEY")]
    sign: Vec<AnyPrivateKey>,

    /// push: token id
    #[clap(long, default_value_t = 1)]
    token_id: u32,

    /// push: transactions prepared (signed) per batch
    #[clap(long, default_value_t = 2000)]
    batch: usize,

    /// push: seconds until a transaction expires, from when its batch is prepared
    #[clap(long, default_value_t = 30)]
    expire_seconds: i64,

    /// get: the service whose subdomain is queried
    #[clap(long, default_value = "transact")]
    service: String,

    /// get: the path
    #[clap(long, default_value = "/common/tapos/head")]
    path: String,

    /// A label copied into the output
    #[clap(long, default_value = "")]
    label: String,
}

#[derive(serde::Deserialize)]
#[allow(non_snake_case)]
struct TaposRefBlock {
    refBlockSuffix: u32,
    refBlockIndex: u8,
}

#[derive(Default)]
struct Stats {
    accepted: usize,
    failures: BTreeMap<String, usize>,
    latencies: Vec<Duration>,
    busy: Duration,
}

impl Stats {
    fn merge(&mut self, other: Stats) {
        self.accepted += other.accepted;
        for (k, v) in other.failures {
            *self.failures.entry(k).or_default() += v;
        }
        self.latencies.extend(other.latencies);
    }
}

fn service_url(api: &url::Url, service: &str, path: &str) -> Result<url::Url, anyhow::Error> {
    let mut url = api.clone();
    let host = api.host_str().ok_or_else(|| anyhow!("--api has no host"))?;
    url.set_host(Some(&format!("{}.{}", service, host)))?;
    Ok(url.join(path)?)
}

fn make_client(args: &Args) -> Result<reqwest::Client, anyhow::Error> {
    let mut headers = reqwest::header::HeaderMap::new();
    if let Some(token) = &args.token {
        headers.insert(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", token).parse()?,
        );
    }
    for header in &args.headers {
        let (name, value) = header
            .split_once(':')
            .ok_or_else(|| anyhow!("--header expects `Name: value`"))?;
        headers.insert(
            reqwest::header::HeaderName::from_bytes(name.trim().as_bytes())?,
            value.trim().parse()?,
        );
    }
    let mut builder = reqwest::Client::builder()
        .default_headers(headers)
        .pool_max_idle_per_host(args.connections)
        .pool_idle_timeout(None)
        .tcp_nodelay(true);
    if let Some(addr) = args.connect {
        let host = args.api.host_str().ok_or_else(|| anyhow!("--api has no host"))?;
        builder = builder.resolve(host, addr);
        for service in ["transact", args.service.as_str()] {
            builder = builder.resolve(&format!("{}.{}", service, host), addr);
        }
    }
    Ok(builder.build()?)
}

// What went wrong, short enough to count by
fn failure_kind(text: &str) -> String {
    let line = text.lines().next().unwrap_or("").trim();
    let mut kind: String = line.chars().take(80).collect();
    if kind.is_empty() {
        kind = "empty reply".to_string();
    }
    kind
}

async fn one_request(request: reqwest::RequestBuilder, push: bool) -> Result<(), String> {
    let reply = request.send().await.map_err(|e| {
        if e.is_timeout() {
            "timeout".to_string()
        } else if e.is_connect() {
            "connect".to_string()
        } else {
            failure_kind(&format!("transport: {}", e))
        }
    })?;
    let status = reply.status();
    let body = reply
        .bytes()
        .await
        .map_err(|e| failure_kind(&format!("transport: {}", e)))?;
    if !status.is_success() {
        return Err(format!(
            "HTTP {}: {}",
            status.as_u16(),
            failure_kind(&String::from_utf8_lossy(&body))
        ));
    }
    if push {
        // The reply is the transaction's trace
        let trace: serde_json::Value =
            serde_json::from_slice(&body).map_err(|_| "reply is not JSON".to_string())?;
        match trace.get("error") {
            Some(serde_json::Value::Null) | None => {}
            Some(serde_json::Value::String(e)) => return Err(failure_kind(e)),
            Some(other) => return Err(failure_kind(&other.to_string())),
        }
    }
    Ok(())
}

// Sends the requests over at most `connections` connections, `rate` per
// second if it is not 0, and waits for every answer.
async fn run_batch(
    requests: Vec<reqwest::RequestBuilder>,
    connections: usize,
    rate: f64,
    push: bool,
) -> Stats {
    let semaphore = Arc::new(tokio::sync::Semaphore::new(connections));
    let start = Instant::now();
    let mut tasks = Vec::with_capacity(requests.len());
    for (i, request) in requests.into_iter().enumerate() {
        if rate > 0.0 {
            tokio::time::sleep_until((start + Duration::from_secs_f64(i as f64 / rate)).into())
                .await;
        }
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        tasks.push(tokio::spawn(async move {
            let sent = Instant::now();
            let result = one_request(request, push).await;
            drop(permit);
            (sent.elapsed(), result)
        }));
    }
    let mut stats = Stats::default();
    for task in tasks {
        match task.await {
            Ok((latency, Ok(()))) => {
                stats.accepted += 1;
                stats.latencies.push(latency);
            }
            Ok((_, Err(kind))) => *stats.failures.entry(kind).or_default() += 1,
            Err(_) => *stats.failures.entry("task failed".to_string()).or_default() += 1,
        }
    }
    stats.busy = start.elapsed();
    stats
}

fn percentile(sorted: &[Duration], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let index = ((sorted.len() as f64 * p).ceil() as usize).clamp(1, sorted.len()) - 1;
    sorted[index].as_secs_f64() * 1000.0
}

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    let args = <Args as clap::Parser>::parse();
    if args.connections == 0 || args.count == 0 {
        return Err(anyhow!("--connections and --count must be at least 1"));
    }
    let client = make_client(&args)?;
    let run_id: u32 = std::process::id() ^ (chrono::Utc::now().timestamp_subsec_nanos());
    let mut total = Stats::default();
    let mut prepare = Duration::ZERO;
    let mut pushing = Duration::ZERO;

    match args.mode {
        Mode::Get => {
            let url = service_url(&args.api, &args.service, &args.path)?;
            let requests = (0..args.count).map(|_| client.get(url.clone())).collect();
            let stats = run_batch(requests, args.connections, args.rate, false).await;
            pushing = stats.busy;
            total.merge(stats);
        }
        Mode::Push => {
            if args.from.is_empty() {
                return Err(anyhow!("push needs at least one --from account"));
            }
            let wait_for = match args.wait_for {
                WaitFor::Applied => "applied",
                WaitFor::Final => "final",
            };
            let push_url = service_url(
                &args.api,
                "transact",
                &format!("/push_transaction?wait_for={}", wait_for),
            )?;
            let tapos_url = service_url(&args.api, "transact", "/common/tapos/head")?;
            let mut sequence = 0usize;
            while sequence < args.count {
                // Prepare a batch: nothing is sent while it is signed
                let started = Instant::now();
                let tapos: TaposRefBlock = client
                    .get(tapos_url.clone())
                    .send()
                    .await
                    .context("Failed to get tapos")?
                    .error_for_status()?
                    .json()
                    .await
                    .context("Failed to read tapos")?;
                let expiration = psibase::TimePointSec::from_chrono_floor(
                    chrono::Utc::now() + chrono::Duration::seconds(args.expire_seconds),
                )
                .ok_or_else(|| anyhow!("bad expiration"))?;
                let n = std::cmp::min(args.batch.max(1), args.count - sequence);
                let mut requests = Vec::with_capacity(n);
                for _ in 0..n {
                    let from = args.from[sequence % args.from.len()];
                    let memo = format!("load {:08x} {}", run_id, sequence);
                    sequence += 1;
                    let action = Tokens::pack_from(from).credit(
                        args.token_id,
                        args.to,
                        Quantity::from(1u64),
                        memo.try_into()?,
                    );
                    let trx = psibase::Transaction {
                        tapos: psibase::Tapos {
                            expiration,
                            refBlockSuffix: tapos.refBlockSuffix,
                            flags: 0,
                            refBlockIndex: tapos.refBlockIndex,
                        },
                        actions: vec![action],
                        claims: vec![],
                    };
                    let packed = psio::to_pssz(&psibase::sign_transaction(trx, &args.sign)?);
                    requests.push(
                        client
                            .post(push_url.clone())
                            .header("Content-Type", "application/octet-stream")
                            .header("Accept", "application/json")
                            .body(packed),
                    );
                }
                prepare += started.elapsed();
                let stats = run_batch(requests, args.connections, args.rate, true).await;
                pushing += stats.busy;
                total.merge(stats);
            }
        }
    }

    total.latencies.sort();
    let seconds = pushing.as_secs_f64();
    let failed: usize = total.failures.values().sum();
    let result = serde_json::json!({
        "label": args.label,
        "mode": match args.mode { Mode::Push => "push", Mode::Get => "get" },
        "requests": args.count,
        "connections": args.connections,
        "offered_rate": args.rate,
        "wait_for": if args.mode == Mode::Push { format!("{:?}", args.wait_for).to_lowercase() } else { String::new() },
        "signed": !args.sign.is_empty(),
        "authenticated": args.token.is_some(),
        "accepted": total.accepted,
        "failed": failed,
        "failures": total.failures,
        "seconds": seconds,
        "prepare_seconds": prepare.as_secs_f64(),
        "accepted_per_second": if seconds > 0.0 { total.accepted as f64 / seconds } else { 0.0 },
        "latency_ms": {
            "p50": percentile(&total.latencies, 0.50),
            "p90": percentile(&total.latencies, 0.90),
            "p99": percentile(&total.latencies, 0.99),
            "max": percentile(&total.latencies, 1.0),
        },
    });
    println!("{}", result);
    Ok(())
}
