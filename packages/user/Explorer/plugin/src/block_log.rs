use serde::Deserialize;
use serde_json::Value;

use crate::bindings::explorer::plugin::types::{BlockHeader, BlockRange};
use crate::bindings::host::http::api::post_graphql_get_json;
use crate::bindings::host::types::types::Error;
use crate::decode::ActionDecoder;
use crate::errors::ErrorType;

/// Genesis is block 2 and can't be displayed, so the explorer starts at block 3.
const FIRST_VISIBLE_BLOCK: u32 = 3;

const DEFAULT_MAX_SEARCH_BLOCKS: u32 = 20000;

const HEADER_FIELDS: &str = "previous blockNum time producer term commitNum";

/// Fields for list views. Deliberately omits action payloads.
///
/// `transaction` is redacted (null) unless the logged-in user is a party to it;
/// `numActions` and `actionsReceived` are public.
const BLOCK_SUMMARY_FIELDS: &str = "
    id
    header { previous blockNum time producer term commitNum }
    actionsReceived { service count }
    transactions {
        id
        numActions
        transaction { actions { sender service method } }
    }
";

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

fn range_args(mut range: BlockRange) -> String {
    if range.ge.is_none() && range.gt.is_none() {
        range.ge = Some(FIRST_VISIBLE_BLOCK);
    } else if range.ge.is_some_and(|ge| ge < FIRST_VISIBLE_BLOCK) {
        range.ge = Some(FIRST_VISIBLE_BLOCK);
    } else if range.gt.is_some_and(|gt| gt < FIRST_VISIBLE_BLOCK - 1) {
        range.gt = Some(FIRST_VISIBLE_BLOCK - 1);
    }

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
fn decode_transaction(decoder: &mut ActionDecoder, trx: &mut Value) {
    if let Some(actions) = trx
        .get_mut("transaction")
        .and_then(|t| t.get_mut("actions"))
    {
        decoder.decode_actions(actions);
    }
}

fn decode_transactions(decoder: &mut ActionDecoder, transactions: &mut Value) {
    if let Some(transactions) = transactions.as_array_mut() {
        for trx in transactions {
            decode_transaction(decoder, trx);
        }
    }
}

pub fn get_blocks(range: BlockRange) -> Result<String, Error> {
    let data = query(&format!(
        "{{ blocks({}) {{
            pageInfo {{ hasPreviousPage hasNextPage startCursor endCursor }}
            edges {{ cursor node {{ {BLOCK_SUMMARY_FIELDS} }} }}
        }} }}",
        range_args(range)
    ))?;
    Ok(to_json(&data["blocks"]))
}

pub fn get_block(block_num: u32) -> Result<Option<String>, Error> {
    if block_num < FIRST_VISIBLE_BLOCK {
        return Ok(None);
    }
    let mut data = query(&format!(
        "{{ block(blockNum: {block_num}) {{ {BLOCK_FULL_FIELDS} }} }}"
    ))?;
    let Some(mut block) = non_null(data["block"].take()) else {
        return Ok(None);
    };
    decode_transactions(&mut ActionDecoder::default(), &mut block["transactions"]);
    Ok(Some(to_json(&block)))
}

pub fn get_block_summary(block_num: u32) -> Result<Option<String>, Error> {
    if block_num < FIRST_VISIBLE_BLOCK {
        return Ok(None);
    }
    let mut data = query(&format!(
        "{{ block(blockNum: {block_num}) {{ {BLOCK_SUMMARY_FIELDS} }} }}"
    ))?;
    Ok(non_null(data["block"].take()).map(|block| to_json(&block)))
}

pub fn get_block_header(block_num: u32) -> Result<Option<BlockHeader>, Error> {
    if block_num < FIRST_VISIBLE_BLOCK {
        return Ok(None);
    }
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
        decode_transaction(&mut ActionDecoder::default(), trx);
    }
    Ok(Some(to_json(&location)))
}
