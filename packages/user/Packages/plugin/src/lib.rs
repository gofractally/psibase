#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType;

use serde::{Deserialize, Serialize};

use host::common::{client as Client, server as Server, types as CommonTypes};

use accounts::plugin::api as Accounts;
use setcode::plugin::api as SetCode;
use sites::plugin::api as Sites;
use staged_tx::plugin::proposer as StagedTx;

use crate::bindings::transact::plugin::intf::add_action_to_transaction;
use crate::packages::plugin::types;
use exports::packages::plugin::private_api::Guest as PrivateApi;
use exports::packages::plugin::queries::Guest as Queries;

use psibase::fracpack::{Pack, Unpack};
use psibase::services::packages::PackageSource;
use psibase::{
    get_essential_packages, make_refs, method, solve_dependencies, AccountNumber, Action,
    EssentialServices, InstalledPackageInfo, PackageDisposition, PackageManifest, PackagedService,
    SchemaMap, SignedTransaction, StagedUpload, Tapos, Transaction, TransactionBuilder,
};

use psibase::services::{
    packages as PackagesService, setcode as SetCodeService, sites as SitesService,
};

use std::cell::Cell;
use std::collections::HashSet;
use std::io::{Cursor, Read, Seek};

impl From<types::PackageRef> for psibase::PackageRef {
    fn from(value: types::PackageRef) -> psibase::PackageRef {
        psibase::PackageRef {
            name: value.name,
            version: value.version,
        }
    }
}

impl From<psibase::PackageRef> for types::PackageRef {
    fn from(value: psibase::PackageRef) -> types::PackageRef {
        types::PackageRef {
            name: value.name,
            version: value.version,
        }
    }
}

impl From<types::PackageInfo> for psibase::PackageInfo {
    fn from(value: types::PackageInfo) -> Self {
        psibase::PackageInfo {
            name: value.name,
            version: value.version,
            description: value.description,
            depends: value.depends.into_iter().map(|d| d.into()).collect(),
            accounts: value
                .accounts
                .into_iter()
                .map(|a| a.as_str().into())
                .collect(),
            sha256: value.sha256.parse().unwrap(),
            file: value.file,
        }
    }
}

impl From<psibase::PackageInfo> for types::PackageInfo {
    fn from(value: psibase::PackageInfo) -> Self {
        types::PackageInfo {
            name: value.name,
            version: value.version,
            description: value.description,
            depends: value.depends.into_iter().map(|d| d.into()).collect(),
            accounts: value.accounts.into_iter().map(|a| a.to_string()).collect(),
            sha256: value.sha256.to_string(),
            file: value.file,
        }
    }
}

impl From<types::PackagePreference> for psibase::PackagePreference {
    fn from(value: types::PackagePreference) -> Self {
        match value {
            types::PackagePreference::Best => psibase::PackagePreference::Latest,
            types::PackagePreference::Compatible => psibase::PackagePreference::Compatible,
            types::PackagePreference::Current => psibase::PackagePreference::Current,
        }
    }
}

impl From<psibase::Meta> for types::Meta {
    fn from(value: psibase::Meta) -> Self {
        types::Meta {
            name: value.name,
            version: value.version,
            description: value.description,
            depends: value.depends.into_iter().map(|d| d.into()).collect(),
            accounts: value.accounts.into_iter().map(|a| a.to_string()).collect(),
        }
    }
}

impl From<psibase::PackageOp> for types::PackageOpInfo {
    fn from(value: psibase::PackageOp) -> Self {
        match value {
            psibase::PackageOp::Install(new) => types::PackageOpInfo {
                old: None,
                new: Some(new.into()),
            },
            psibase::PackageOp::Replace(old, new) => types::PackageOpInfo {
                old: Some(old.into()),
                new: Some(new.into()),
            },
            psibase::PackageOp::Remove(old) => types::PackageOpInfo {
                old: Some(old.into()),
                new: None,
            },
        }
    }
}

struct PackagesPlugin;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct QueryRoot<T> {
    data: T,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SourcesQuery {
    sources: Vec<types::PackageSource>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct InstalledEdge {
    node: InstalledPackageInfo,
}

#[allow(non_snake_case)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct NextPageInfo {
    hasNextPage: bool,
    endCursor: String,
}

#[allow(non_snake_case)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct InstalledConnection {
    pageInfo: NextPageInfo,
    edges: Vec<InstalledEdge>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct InstalledQuery {
    installed: InstalledConnection,
}

type InstalledRoot = QueryRoot<InstalledQuery>;

fn get_installed_packages() -> Result<Vec<psibase::InstalledPackageInfo>, CommonTypes::Error> {
    let mut end_cursor: Option<String> = None;
    let mut result = Vec::new();
    loop {
        let json = Server::post_graphql_get_json(
            &format!("query {{ installed(first: 100, after: {}) {{ pageInfo {{ hasNextPage endCursor }} edges {{ node {{ name version description depends {{ name version }}  accounts owner }} }} }} }}", serde_json::to_string(&end_cursor).unwrap())).map_err(|e| ErrorType::QueryError(e.message))?;
        let root: InstalledRoot =
            serde_json::from_str(&json).map_err(|e| ErrorType::QueryError(e.to_string()))?;
        for edge in root.data.installed.edges {
            result.push(edge.node);
        }
        if !root.data.installed.pageInfo.hasNextPage {
            break;
        }
        end_cursor = Some(root.data.installed.pageInfo.endCursor);
    }
    Ok(result)
}

fn as_upgradable(
    packages: &[psibase::InstalledPackageInfo],
) -> Vec<(psibase::Meta, PackageDisposition)> {
    packages
        .iter()
        .map(|package| {
            (
                package.meta(),
                PackageDisposition::upgradable(&package.version),
            )
        })
        .collect()
}

fn get_installed_manifest(
    package: &str,
    owner: AccountNumber,
) -> Result<PackageManifest, CommonTypes::Error> {
    let json = Server::get_json(&format!("/manifest?package={}&owner={}", package, owner))?;
    Ok(serde_json::from_str(&json).map_err(|e| ErrorType::JsonError(e.to_string()))?)
}

fn load_schemas<R: Read + Seek>(
    package: &mut PackagedService<R>,
    schemas: &mut SchemaMap,
) -> Result<(), CommonTypes::Error> {
    package
        .get_all_schemas(schemas)
        .map_err(|e| ErrorType::PackageFormatError(e.to_string()))?;
    let mut required = HashSet::new();
    package
        .get_required_schemas(&mut required)
        .map_err(|e| ErrorType::PackageFormatError(e.to_string()))?;
    for account in required {
        if !schemas.contains_key(&account) {
            schemas.insert(
                account,
                serde_json::from_str(&Server::get_json(&format!("/schema?service={account}"))?)
                    .map_err(|e| ErrorType::JsonError(e.to_string()))?,
            );
        }
    }
    Ok(())
}

#[allow(non_snake_case)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct NewAccountsQuery {
    newAccounts: Vec<AccountNumber>,
}

fn get_package_accounts(
    ops: &[types::PackageOpFull],
) -> Result<Vec<AccountNumber>, CommonTypes::Error> {
    let mut result = Vec::new();
    for op in ops {
        if let Some(new) = &op.new {
            let package = PackagedService::new(Cursor::new(&new[..]))
                .map_err(|e| ErrorType::PackageFormatError(e.to_string()))?;
            result.extend_from_slice(package.get_accounts());
        }
    }
    Ok(result)
}

fn get_accounts_to_create(
    accounts: &[AccountNumber],
    sender: AccountNumber,
) -> Result<Vec<AccountNumber>, CommonTypes::Error> {
    let json = Server::post_graphql_get_json(&format!(
        "query {{ newAccounts(accounts: {}, owner: {}) }}",
        serde_json::to_string(accounts).unwrap(),
        serde_json::to_string(&sender).unwrap(),
    ))?;
    let result: QueryRoot<NewAccountsQuery> =
        serde_json::from_str(&json).map_err(|e| ErrorType::JsonError(e.to_string()))?;
    Ok(result.data.newAccounts)
}

fn apply_packages<
    F: Fn(Vec<Action>) -> Result<SignedTransaction, anyhow::Error>,
    G: Fn(Vec<Action>) -> Result<SignedTransaction, anyhow::Error>,
>(
    ops: Vec<types::PackageOpFull>,
    mut uploader: StagedUpload,
    out: &mut TransactionBuilder<F>,
    files: &mut TransactionBuilder<G>,
    sender: AccountNumber,
    compression_level: u32,
) -> Result<(), CommonTypes::Error> {
    let mut schemas = SchemaMap::new();
    for op in ops {
        if let Some(new) = op.new {
            let mut package = PackagedService::new(Cursor::new(&new[..]))
                .map_err(|e| ErrorType::PackageFormatError(e.to_string()))?;
            load_schemas(&mut package, &mut schemas)?;
            if let Some(old) = op.old {
                out.set_label(format!(
                    "Updating {}-{} -> {}-{}",
                    &old.name,
                    &old.version,
                    package.name(),
                    package.version()
                ));
                let old_manifest = get_installed_manifest(&old.name, sender)?;
                old_manifest.upgrade(package.manifest(), out).unwrap();
            } else {
                out.set_label(format!(
                    "Installing {}-{}",
                    package.name(),
                    package.version()
                ));
            }
            files.set_label(format!(
                "Uploading files for {}-{}",
                package.name(),
                package.version()
            ));
            let mut account_actions = vec![];
            package
                .install_accounts(&mut account_actions, Some(&mut uploader), sender, &None)
                .map_err(|e| ErrorType::PackageFormatError(e.to_string()))?;
            out.push_all(account_actions).unwrap();
            let mut actions = vec![];
            package
                .install(
                    &mut actions,
                    Some(&mut uploader),
                    sender,
                    true,
                    compression_level,
                    &mut schemas,
                )
                .map_err(|e| ErrorType::PackageFormatError(e.to_string()))?;
            out.push_all(actions).unwrap();
            files
                .push_all(std::mem::take(&mut uploader.actions))
                .unwrap();
        } else if let Some(old) = op.old {
            out.set_label(format!("Removing {}", old.name));
            let old_manifest = get_installed_manifest(&old.name, sender)?;
            old_manifest.remove(out).unwrap();
        }
    }
    Ok(())
}

fn make_transaction(actions: Vec<Action>) -> SignedTransaction {
    let transaction = Transaction {
        tapos: Tapos::default(),
        actions,
        claims: Vec::new(),
    };

    SignedTransaction {
        transaction: transaction.packed().into(),
        proofs: Vec::new(),
    }
}

impl Queries for PackagesPlugin {
    fn get_installed_packages() -> Result<Vec<types::Meta>, CommonTypes::Error> {
        Ok(get_installed_packages()?
            .into_iter()
            .map(|p| p.meta().into())
            .collect())
    }
    fn get_sources(owner: String) -> Result<Vec<types::PackageSource>, CommonTypes::Error> {
        let owner: AccountNumber = owner.parse().unwrap();
        let json = Server::post_graphql_get_json(&format!(
            "query {{ sources(account: {}) {{ url account }} }}",
            serde_json::to_string(&owner).unwrap(),
        ))?;
        let result: QueryRoot<SourcesQuery> =
            serde_json::from_str(&json).map_err(|e| ErrorType::JsonError(e.to_string()))?;
        Ok(result.data.sources)
    }
}

impl PrivateApi for PackagesPlugin {
    fn resolve(
        index: Vec<types::PackageInfo>,
        packages: Vec<String>,
        request_pref: types::PackagePreference,
        non_request_pref: types::PackagePreference,
    ) -> Result<Vec<types::PackageOpInfo>, CommonTypes::Error> {
        let index = index.into_iter().map(|p| p.into()).collect();
        let essential = get_essential_packages(&index, &EssentialServices::new());
        Ok(solve_dependencies(
            index,
            make_refs(&packages).unwrap(),
            as_upgradable(&get_installed_packages()?),
            essential,
            false,
            request_pref.into(),
            non_request_pref.into(),
        )
        .map_err(|e| ErrorType::PackageResolutionError(e.to_string()))?
        .into_iter()
        .map(|op| op.into())
        .collect())
    }
    fn build_transactions(
        owner: String,
        packages: Vec<types::PackageOpFull>,
        compression_level: u8,
    ) -> Result<(Vec<Vec<u8>>, Vec<Vec<u8>>), CommonTypes::Error> {
        let id = getrandom::u64().unwrap();

        let index_cell = Cell::new(0);

        let sender: AccountNumber = owner.parse().unwrap();

        let build_transaction =
            |mut actions: Vec<Action>| -> Result<SignedTransaction, anyhow::Error> {
                let index = index_cell.get();
                index_cell.set(index + 1);
                actions.insert(
                    0,
                    PackagesService::Wrapper::pack_from(sender).checkOrder(id.clone(), index),
                );
                Ok(make_transaction(actions))
            };

        let action_limit: usize = 1024 * 1024;

        let mut trx_builder = TransactionBuilder::new(action_limit, build_transaction);

        // We don't need to create the accounts first anymore,
        // but the query checks that any accounts that already
        // exist have the right owner.
        get_accounts_to_create(&get_package_accounts(&packages)?, sender)?;

        let user = Accounts::get_current_user().ok_or(ErrorType::NoLoggedInUser)?;
        let uploader = StagedUpload::new(id, user.parse().unwrap());

        let mut upload_builder = TransactionBuilder::new(
            action_limit,
            |actions: Vec<Action>| -> Result<SignedTransaction, anyhow::Error> {
                Ok(make_transaction(actions))
            },
        );
        apply_packages(
            packages,
            uploader,
            &mut trx_builder,
            &mut upload_builder,
            sender,
            compression_level.into(),
        )?;

        trx_builder
            .push(PackagesService::Wrapper::pack_from(sender).removeOrder(id.clone()))
            .unwrap();

        let mut upload_transactions = Vec::new();
        for (_label, group, _carry) in upload_builder.finish().unwrap() {
            for tx in group {
                upload_transactions.push(tx.transaction.0)
            }
        }
        let mut install_transactions = Vec::new();
        for (_label, group, _carry) in trx_builder.finish().unwrap() {
            for tx in group {
                install_transactions.push(tx.transaction.0)
            }
        }
        Ok((upload_transactions, install_transactions))
    }
    // Only callable by the UI
    fn push_data(tx: Vec<u8>) {
        assert!(Client::get_sender() == "config".to_string());

        let tx = Transaction::unpacked(&tx).unwrap();
        for action in tx.actions {
            if action.service == SitesService::SERVICE && action.method == method!("storeSys") {
                let data =
                    SitesService::action_structs::storeSys::unpacked(&action.rawData).unwrap();
                let file = Sites::File {
                    path: data.path,
                    content_type: data.contentType,
                    content: data.content.0,
                };
                if let Some(encoding) = data.contentEncoding {
                    Sites::upload_encoded(&file, &encoding).unwrap()
                } else {
                    Sites::upload(&file, 0).unwrap()
                }
            } else if action.service == SetCodeService::SERVICE
                && action.method == method!("stageCode")
            {
                let data =
                    SetCodeService::action_structs::stageCode::unpacked(&action.rawData).unwrap();
                assert!(data.vmType == 0);
                assert!(data.vmVersion == 0);
                SetCode::stage_service_code(&data.service.to_string(), data.id, &data.code.0)
            }
        }
    }
    fn propose_install(tx: Vec<u8>) -> Result<(), CommonTypes::Error> {
        assert!(Client::get_sender() == "config".to_string());

        let tx = Transaction::unpacked(&tx).unwrap();
        StagedTx::propose(
            &tx.actions.into_iter().map(|a| a.into()).collect::<Vec<_>>(),
            true,
        )
    }

    fn set_account_sources(accounts: Vec<String>) -> Result<(), CommonTypes::Error> {
        // TODO: Review
        // assert!(Client::get_sender() == "config".to_string());

        let packed_args = psibase::services::packages::action_structs::setSources {
            sources: accounts
                .into_iter()
                .map(|account| PackageSource {
                    account: Some(AccountNumber::from(account.as_str())),
                    url: None,
                })
                .collect(),
        }
        .packed();

        add_action_to_transaction(
            psibase::services::packages::action_structs::setSources::ACTION_NAME,
            &packed_args,
        )?;
        Ok(())
    }
}

impl From<Action> for transact::plugin::types::Action {
    fn from(action: Action) -> Self {
        transact::plugin::types::Action {
            sender: action.sender.to_string(),
            service: action.service.to_string(),
            method: action.method.to_string(),
            raw_data: action.rawData.0,
        }
    }
}

bindings::export!(PackagesPlugin with_types_in bindings);
