//! Build/sign a transaction containing independent Ethereum evidence claims.
//! Custody secrets are never used: --key is the relayer's Psibase auth key.
use psibase::fracpack::Pack;
use psibase::*;
use serde::Deserialize;
use std::path::Path;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Bundle {
    actions: Vec<PrettyAction>,
    witnesses: Vec<ethrelay_core::Witness>,
}
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() == 3 && args[1] == "inspect" {
        let data = std::fs::read(&args[2])?;
        anyhow::ensure!(
            data.len() <= ethrelay_core::MAX_WITNESS,
            "Witness size limit"
        );
        let w: ethrelay_core::Witness = serde_json::from_slice(&data)?;
        let f = w.check().map_err(anyhow::Error::msg)?;
        println!(
            "{}",
            serde_json::json!({"fact":f,"claim":ethrelay_core::hex(f.commitment())})
        );
        return Ok(());
    }
    anyhow::ensure!(args.len()>=5,"Usage: ethbridge-relayer inspect witness.json | submit NODE_URL bundle.json AUTH_KEY.pem [AUTH_KEY.pem ...]");
    anyhow::ensure!(args[1] == "submit", "Unknown command");
    let base: url::Url = args[2].parse()?;
    let data = std::fs::read(&args[3])?;
    anyhow::ensure!(data.len() <= 2_000_000, "Bundle size limit");
    let bundle: Bundle = serde_json::from_slice(&data)?;
    anyhow::ensure!(
        !bundle.actions.is_empty() && bundle.actions.len() <= 8 && bundle.witnesses.len() <= 8,
        "Bundle count limit"
    );
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(150))
        .build()?;
    let mut schemas = SchemaMap::new();
    for action in &bundle.actions {
        let service: AccountNumber = action.service.into();
        if !schemas.contains_key(&service) {
            schemas.insert(
                service,
                as_json(
                    client.get(
                        services::packages::SERVICE
                            .url(&base)?
                            .join(&format!("/schema?service={service}"))?,
                    ),
                )
                .await?,
            );
        }
    }
    let actions = bundle
        .actions
        .into_iter()
        .map(|a| a.into_action(&schemas))
        .collect::<Result<Vec<_>, _>>()?;
    let mut keys = vec![];
    for path in &args[4..] {
        let path = Path::new(path);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let m = std::fs::symlink_metadata(path)?;
            anyhow::ensure!(
                m.is_file() && m.permissions().mode() & 0o077 == 0,
                "Auth key must be a private regular file (0600)"
            );
        }
        keys.push(load_private_key(path.to_str().ok_or_else(||anyhow::anyhow!("Auth key path must be UTF-8"))?)?);
    }
    let mut claims: Vec<_> = keys.iter().map(|k| k.get_claim()).collect();
    let mut extra = vec![];
    for witness in bundle.witnesses {
        let f = witness.check().map_err(anyhow::Error::msg)?;
        claims.push(Claim {
            service: account!("verify-eth"),
            rawData: f.commitment().to_vec().into(),
        });
        let proof = serde_json::to_vec(&witness)?;
        anyhow::ensure!(
            proof.len() <= ethrelay_core::MAX_WITNESS,
            "Evidence size limit"
        );
        extra.push(proof.into());
    }
    // Validate potentially expensive witnesses before starting the TAPOS window.
    let tapos = get_tapos_for_head(&base, client.clone()).await?;
    let trx = Transaction {
        tapos: Tapos {
            expiration: TimePointSec::from_chrono_floor(chrono::Utc::now() + chrono::Duration::seconds(120)).unwrap(),
            refBlockSuffix: tapos.ref_block_suffix,
            refBlockIndex: tapos.ref_block_index,
            flags: 0,
        },
        actions,
        claims,
    };
    let packed = trx.packed();
    let mut proofs: Vec<Hex<Vec<u8>>> = keys.iter().map(|k| k.sign(&packed).into()).collect();
    proofs.extend(extra);
    let signed = SignedTransaction {
        transaction: packed.into(),
        proofs,
        subjectiveData: None,
    };
    let response = client
        .post(
            services::transact::SERVICE
                .url(&base)?
                .join("/push_transaction")?,
        )
        .header("Content-Type", "application/octet-stream")
        .header("Accept", "application/json")
        .body(signed.packed())
        .send()
        .await?;
    let status = response.status();
    let body = response.text().await?;
    println!("{body}");
    anyhow::ensure!(status.is_success(), "Transaction rejected: {status}");
    let trace: serde_json::Value = serde_json::from_str(&body)?;
    anyhow::ensure!(
        trace.get("error").is_none_or(|e| e.is_null()),
        "Transaction failed: {}", trace.get("error").unwrap_or(&serde_json::Value::Null)
    );
    Ok(())
}
