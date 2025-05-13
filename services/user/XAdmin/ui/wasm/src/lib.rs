#[allow(warnings)]
mod bindings;
use std::{io::Cursor, str::FromStr};

use bindings::*;

use exports::psibase::x_admin::boot::{Guest as Boot, *};
use exports::psibase::x_admin::packages::Guest as Packages;
use exports::psibase::x_admin::util::Guest as Util;
use psibase::fracpack::{Pack, Unpack};
use psibase::*;

const DEBUG_PRINT: bool = false;

fn parse_public_key_pem(public_key_pem: Option<String>) -> Result<Option<AnyPublicKey>, String> {
    public_key_pem
        .map(|k| -> Result<AnyPublicKey, String> {
            let data = pem::parse(k.trim()).map_err(|e| e.to_string())?;

            if data.tag() != "PUBLIC KEY" {
                return Err("Invalid public key".to_string());
            }

            spki::SubjectPublicKeyInfoRef::try_from(data.contents())
                .map_err(|e| format!("Invalid SPKI format: {}", e))?;

            Ok(AnyPublicKey {
                key: crate::Claim {
                    service: AccountNumber::from_str("verify-sig").unwrap(),
                    rawData: data.contents().to_vec().into(),
                },
            })
        })
        .transpose()
}

struct XAdminPlugin;

impl Boot for XAdminPlugin {
    fn boot_transactions(
        producer: String,
        js_packages: Vec<PackageContents>,
        block_signing_key: Option<Pem>,
        tx_signing_key: Option<Pem>,
        compression_level: u32,
    ) -> Result<(Tx, Vec<(Tx, u32, u32)>, Vec<String>), String> {
        let mut services: Vec<PackagedService<Cursor<&[u8]>>> = vec![];
        for s in &js_packages[..] {
            services.push(PackagedService::new(Cursor::new(&s[..])).map_err(|e| e.to_string())?);
        }

        let expiration = TimePointSec::from(chrono::Utc::now() + chrono::Duration::seconds(240));
        let prod = ExactAccountNumber::from_str(&producer).map_err(|e| e.to_string())?;

        let initial_key = parse_public_key_pem(block_signing_key)?;
        let tx_key = parse_public_key_pem(tx_signing_key)?;

        let (boot_transactions, groups) = create_boot_transactions(
            &initial_key,
            &tx_key,
            prod.into(),
            true,
            expiration,
            &mut services[..],
            compression_level,
        )
        .map_err(|e| e.to_string())?;

        if DEBUG_PRINT {
            let mut tx_sizes: Vec<String> = Vec::new();
            for (_, transactions, _) in &groups {
                for tx in transactions {
                    tx_sizes.push(format!("{:?} kb", tx.packed().len() / 1024));
                }
            }
            println!("{:?}", tx_sizes);
        }

        let boot_transactions = boot_transactions.packed();

        let mut labels = Vec::new();
        let mut transactions = Vec::new();
        let mut completed: u32 = 0;
        let mut idx: u32 = 0;
        for (label, group, carry) in groups {
            labels.push(label);
            if !carry {
                completed = idx;
            }
            for tx in group {
                transactions.push((Tx::from(tx.packed()), completed, idx + 1));
                completed = idx;
            }
            idx += 1;
        }

        Ok((boot_transactions, transactions, labels))
    }
}

impl Util for XAdminPlugin {
    fn deserialize_trace(buffer: Vec<u8>) -> Result<String, String> {
        let trace = TransactionTrace::unpacked(&buffer).map_err(|e| e.to_string())?;
        Ok(serde_json::to_string(&trace).map_err(|e| e.to_string())?)
    }
}

impl Packages for XAdminPlugin {
    fn resolve_packages(index_json_str: String, packages: Vec<String>) -> Result<String, String> {
        let index = serde_json::from_str(&index_json_str).map_err(|e| e.to_string())?;
        let pinned: Vec<(Meta, PackageDisposition)> = vec![];
        let refs = make_refs(&packages).map_err(|e| e.to_string())?;
        let essential = get_essential_packages(&index, &EssentialServices::new());

        let solved = solve_dependencies(
            index,
            refs,
            pinned,
            essential,
            false,
            PackagePreference::Latest,
            PackagePreference::Latest,
        )
        .map_err(|e| e.to_string())?;

        Ok(serde_json::to_string(&solved).map_err(|e| e.to_string())?)
    }
}

bindings::export!(XAdminPlugin with_types_in bindings);
