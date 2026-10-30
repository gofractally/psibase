use futures::executor::block_on;
use serde::Deserialize;
use serde_json::Value;

use crate::bindings::explorer::plugin::types::{BlockHeader, BlockRange};
use crate::bindings::host::http::api::post_graphql_get_json;
use crate::decode::ActionDecoder;
use crate::errors::ErrorType;
use psibase_plugin::Error;

const DEFAULT_MAX_SEARCH_BLOCKS: u32 = 20000;

const HEADER_FIELDS: &str = "previous blockNum time producer term commitNum";

/// Fields for list views, without `transactions`.
const BLOCK_SUMMARY_FIELDS: &str = "
    id
    header { previous blockNum time producer term commitNum }
    actionsReceived { service count }
";

/// Deliberately omits action payloads.
///
/// `transaction` is redacted (null) unless the logged-in user is a party to it;
/// `numActions` and `actionsReceived` are public.
const SUMMARY_TRANSACTIONS_FIELD: &str = "
    transactions {
        id
        numActions
        transaction { actions { sender service method } }
    }
";

/// Fields for the block page, without `transactions`.
const BLOCK_FULL_FIELDS: &str = "
    id
    header {
        previous
        blockNum
        time
        producer
        term
        commitNum
        consensusState
        trxMerkleRoot
        eventMerkleRoot
        newConsensus {
            data {
                ... on CftConsensus { cft: producers { name auth { service rawData } } }
                ... on BftConsensus { bft: producers { name auth { service rawData } } }
            }
            services { codeNum codeHash vmType vmVersion }
            wasmConfig {
                numExecutionMemories
                vmOptions {
                    max_mutable_global_bytes
                    max_pages
                    max_table_elements
                    max_stack_bytes
                }
            }
        }
    }
    actionsReceived { service count }
";

const FULL_TRANSACTIONS_FIELD: &str = "
    transactions {
        id
        numActions
        transaction { actions { sender service method rawData } }
        proofs
    }
";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeaderJson {
    previous: String,
    block_num: u32,
    time: String,
    producer: String,
    term: u32,
    commit_num: u32,
}

impl From<HeaderJson> for BlockHeader {
    fn from(header: HeaderJson) -> Self {
        BlockHeader {
            previous: header.previous,
            block_num: header.block_num,
            time: header.time,
            producer: header.producer,
            term: header.term,
            commit_num: header.commit_num,
        }
    }
}

fn query(graphql: &str) -> Result<Value, Error> {
    let json = post_graphql_get_json(graphql)?;
    let mut root: Value =
        serde_json::from_str(&json).map_err(|e| ErrorType::JsonError(e.to_string()))?;
    Ok(root["data"].take())
}

fn to_json(value: &Value) -> String {
    serde_json::to_string(value).unwrap()
}

fn non_null(value: Value) -> Option<Value> {
    (!value.is_null()).then_some(value)
}

fn parse_header(value: Value) -> Result<Option<BlockHeader>, Error> {
    let Some(value) = non_null(value) else {
        return Ok(None);
    };
    let header: HeaderJson =
        serde_json::from_value(value).map_err(|e| ErrorType::JsonError(e.to_string()))?;
    Ok(Some(header.into()))
}

/// Runs the query built by `graphql` with `transactions` among the block fields. If that
/// fails, for example because the transactions are too large to return, runs it again
/// without them; the returned flag says whether the transactions were included.
fn query_blocks(
    graphql: impl Fn(&str) -> String,
    transactions: &str,
) -> Result<(Value, bool), Error> {
    match query(&graphql(transactions)) {
        Ok(data) => Ok((data, true)),
        Err(_) => Ok((query(&graphql(""))?, false)),
    }
}

/// Null `transactions` tell the UI that they can't be displayed. This differs from a
/// redacted transaction, which has a null `transaction`.
fn mark_transactions_unavailable(block: &mut Value) {
    if let Some(block) = block.as_object_mut() {
        block.insert("transactions".to_string(), Value::Null);
    }
}

fn range_args(range: BlockRange) -> String {
    let numbers = [
        ("gt", range.gt),
        ("ge", range.ge),
        ("lt", range.lt),
        ("le", range.le),
        ("first", range.first),
        ("last", range.last),
    ];
    let strings = [("before", range.before), ("after", range.after)];

    numbers
        .into_iter()
        .filter_map(|(name, value)| value.map(|v| format!("{name}: {v}")))
        .chain(strings.into_iter().filter_map(|(name, value)| {
            value
                .filter(|v| !v.is_empty())
                .map(|v| format!("{name}: {}", serde_json::to_string(&v).unwrap()))
        }))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Redacted transactions have a null `transaction` and are left untouched.
async fn decode_transaction(decoder: &ActionDecoder, trx: &mut Value) {
    if let Some(actions) = trx
        .get_mut("transaction")
        .and_then(|t| t.get_mut("actions"))
    {
        decoder.decode_actions(actions).await;
    }
}

async fn decode_transactions(decoder: &ActionDecoder, transactions: &mut Value) {
    if let Some(transactions) = transactions.as_array_mut() {
        for trx in transactions {
            decode_transaction(decoder, trx).await;
        }
    }
}

pub fn get_blocks(range: BlockRange) -> Result<String, Error> {
    let args = range_args(range);
    let (mut data, has_transactions) = query_blocks(
        |transactions| {
            format!(
                "{{ blocks({args}) {{
                    pageInfo {{ hasPreviousPage hasNextPage startCursor endCursor }}
                    edges {{ cursor node {{ {BLOCK_SUMMARY_FIELDS} {transactions} }} }}
                }} }}"
            )
        },
        SUMMARY_TRANSACTIONS_FIELD,
    )?;
    if !has_transactions {
        if let Some(edges) = data["blocks"]["edges"].as_array_mut() {
            for edge in edges {
                mark_transactions_unavailable(&mut edge["node"]);
            }
        }
    }
    Ok(to_json(&data["blocks"]))
}

fn query_block(block_num: u32, fields: &str, transactions: &str) -> Result<Option<Value>, Error> {
    let (mut data, has_transactions) = query_blocks(
        |transactions| format!("{{ block(blockNum: {block_num}) {{ {fields} {transactions} }} }}"),
        transactions,
    )?;
    let Some(mut block) = non_null(data["block"].take()) else {
        return Ok(None);
    };
    if !has_transactions {
        mark_transactions_unavailable(&mut block);
    }
    Ok(Some(block))
}

pub fn get_block(block_num: u32) -> Result<Option<String>, Error> {
    let Some(mut block) = query_block(block_num, BLOCK_FULL_FIELDS, FULL_TRANSACTIONS_FIELD)?
    else {
        return Ok(None);
    };
    block_on(decode_transactions(
        &ActionDecoder::default(),
        &mut block["transactions"],
    ));
    Ok(Some(to_json(&block)))
}

pub fn get_block_summary(block_num: u32) -> Result<Option<String>, Error> {
    let block = query_block(block_num, BLOCK_SUMMARY_FIELDS, SUMMARY_TRANSACTIONS_FIELD)?;
    Ok(block.map(|block| to_json(&block)))
}

pub fn get_block_header(block_num: u32) -> Result<Option<BlockHeader>, Error> {
    let mut data = query(&format!(
        "{{ block(blockNum: {block_num}) {{ header {{ {HEADER_FIELDS} }} }} }}"
    ))?;
    parse_header(data["block"]["header"].take())
}

pub fn get_head() -> Result<Option<BlockHeader>, Error> {
    let mut data = query(&format!("{{ head {{ {HEADER_FIELDS} }} }}"))?;
    parse_header(data["head"].take())
}

pub fn find_transaction(id: String, max_blocks: Option<u32>) -> Result<Option<String>, Error> {
    let mut data = query(&format!(
        "{{ transaction(id: {}, maxBlocks: {}) {{
            blockNum blockId blockTime producer index
            transaction {{
                id
                numActions
                transaction {{ actions {{ sender service method rawData }} }}
                proofs
            }}
        }} }}",
        serde_json::to_string(&id).unwrap(),
        max_blocks.unwrap_or(DEFAULT_MAX_SEARCH_BLOCKS),
    ))?;
    let Some(mut location) = non_null(data["transaction"].take()) else {
        return Ok(None);
    };
    if let Some(trx) = location.get_mut("transaction") {
        block_on(decode_transaction(&ActionDecoder::default(), trx));
    }
    Ok(Some(to_json(&location)))
}
