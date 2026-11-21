//! Ethereum evidence verified without objective state. Consumers must bind every
//! fact to their own network, trusted checkpoint and replay-protected state.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
pub type Result<T> = std::result::Result<T, String>;
pub type Hash = [u8; 32];
pub const PERIOD: u64 = 8192;
pub const MAX_WITNESS: usize = 196_608;
pub fn ensure(ok: bool, message: &str) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(message.into())
    }
}
pub fn bytes<const N: usize>(s: &str) -> Result<[u8; N]> {
    hex::decode(s.strip_prefix("0x").unwrap_or(s))
        .map_err(|e| e.to_string())?
        .try_into()
        .map_err(|_| format!("Expected {N} bytes"))
}
pub fn hash(data: &[u8]) -> Hash {
    Sha256::digest(data).into()
}
pub fn keccak(data: &[u8]) -> Hash {
    sha3::Keccak256::digest(data).into()
}
pub fn hex(data: impl AsRef<[u8]>) -> String {
    hex::encode(data)
}
pub fn json_hash<T: Serialize>(value: &T) -> Hash {
    hash(&serde_json::to_vec(value).unwrap())
}
pub fn pair(a: Hash, b: Hash) -> Hash {
    let mut d = [0; 64];
    d[..32].copy_from_slice(&a);
    d[32..].copy_from_slice(&b);
    hash(&d)
}
pub fn uint(n: u64) -> Hash {
    let mut r = [0; 32];
    r[..8].copy_from_slice(&n.to_le_bytes());
    r
}
pub fn tree(mut leaves: Vec<Hash>) -> Hash {
    leaves.resize(leaves.len().max(1).next_power_of_two(), [0; 32]);
    while leaves.len() > 1 {
        leaves = leaves.chunks_exact(2).map(|p| pair(p[0], p[1])).collect();
    }
    leaves[0]
}
pub fn branch(mut leaf: Hash, siblings: &[String], mut gindex: u64, root: Hash) -> Result<()> {
    ensure(
        gindex > 1 && siblings.len() == (63 - gindex.leading_zeros()) as usize,
        "Merkle branch length",
    )?;
    for sibling in siblings {
        let s = bytes(sibling)?;
        leaf = if gindex & 1 == 1 {
            pair(s, leaf)
        } else {
            pair(leaf, s)
        };
        gindex >>= 1;
    }
    ensure(leaf == root, "Merkle branch mismatch")
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Fork {
    pub epoch: u64,
    pub version: String,
    pub electra: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Network {
    pub genesis_root: String,
    pub genesis_time: u64,
    pub forks: Vec<Fork>,
}
impl Network {
    pub fn validate(&self) -> Result<()> {
        let _: Hash = bytes(&self.genesis_root)?;
        ensure(
            !self.forks.is_empty() && self.forks.len() <= 16,
            "Fork schedule limit",
        )?;
        for (i, f) in self.forks.iter().enumerate() {
            let _: [u8; 4] = bytes(&f.version)?;
            ensure(
                i == 0 || f.epoch > self.forks[i - 1].epoch,
                "Fork schedule order",
            )?;
        }
        Ok(())
    }
    pub fn fork(&self, slot: u64) -> Result<&Fork> {
        self.forks
            .iter()
            .rev()
            .find(|f| f.epoch <= slot / 32)
            .ok_or_else(|| "Unsupported pre-Deneb fork".into())
    }
    pub fn root(&self) -> String {
        hex(json_hash(self))
    }
    pub fn slot(&self, now: u64) -> Result<u64> {
        Ok(now
            .checked_sub(self.genesis_time)
            .ok_or("Before Ethereum genesis")?
            / 12)
    }
    pub fn signing_root(&self, header: &Beacon, signature_slot: u64) -> Result<Hash> {
        let fork = self.fork(signature_slot.saturating_sub(1))?;
        let mut version = [0; 32];
        version[..4].copy_from_slice(&bytes::<4>(&fork.version)?);
        let data = pair(version, bytes(&self.genesis_root)?);
        let mut domain = [0; 32];
        domain[..4].copy_from_slice(&[7, 0, 0, 0]);
        domain[4..].copy_from_slice(&data[..28]);
        Ok(pair(header.root()?, domain))
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Beacon {
    pub slot: u64,
    pub proposer_index: u64,
    pub parent_root: String,
    pub state_root: String,
    pub body_root: String,
}
impl Beacon {
    pub fn root(&self) -> Result<Hash> {
        Ok(tree(vec![
            uint(self.slot),
            uint(self.proposer_index),
            bytes(&self.parent_root)?,
            bytes(&self.state_root)?,
            bytes(&self.body_root)?,
        ]))
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Committee {
    pub pubkeys: Vec<String>,
    pub aggregate_pubkey: String,
}
impl Committee {
    pub fn root(&self) -> Result<Hash> {
        ensure(self.pubkeys.len() == 512, "Sync committee size")?;
        fn pk(s: &str) -> Result<Hash> {
            let p = bytes::<48>(s)?;
            let mut tail = [0; 32];
            tail[..16].copy_from_slice(&p[32..]);
            Ok(pair(p[..32].try_into().unwrap(), tail))
        }
        Ok(pair(
            tree(self.pubkeys.iter().map(|p| pk(p)).collect::<Result<_>>()?),
            pk(&self.aggregate_pubkey)?,
        ))
    }
}
/// SSZ roots of all 17 Deneb ExecutionPayloadHeader fields. Only authenticated
/// facts needed by consumers are extracted; other fields remain committed roots.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Execution {
    pub fields: Vec<String>,
    pub branch: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExecutionFact {
    pub block_hash: String,
    pub parent_hash: String,
    pub state_root: String,
    pub receipts_root: String,
    pub block_number: u64,
}
impl Execution {
    pub fn check(&self, beacon: &Beacon) -> Result<ExecutionFact> {
        ensure(self.fields.len() == 17, "Deneb payload field count")?;
        let fields = self
            .fields
            .iter()
            .map(|f| bytes(f))
            .collect::<Result<Vec<Hash>>>()?;
        branch(
            tree(fields.clone()),
            &self.branch,
            25,
            bytes(&beacon.body_root)?,
        )?;
        ensure(
            fields[6][8..].iter().all(|b| *b == 0),
            "SSZ block number overflow",
        )?;
        Ok(ExecutionFact {
            block_hash: hex(fields[12]),
            parent_hash: hex(fields[0]),
            state_root: hex(fields[2]),
            receipts_root: hex(fields[3]),
            block_number: u64::from_le_bytes(fields[6][..8].try_into().unwrap()),
        })
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bootstrap {
    pub network: Network,
    pub header: Beacon,
    pub committee: Committee,
    pub committee_branch: Vec<String>,
    pub execution: Execution,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Update {
    pub network: Network,
    pub committee: Committee,
    pub attested: Beacon,
    pub finalized: Beacon,
    pub finality_branch: Vec<String>,
    pub signature_slot: u64,
    pub bits: String,
    pub signature: String,
    pub next: Option<Committee>,
    pub next_branch: Vec<String>,
    pub execution: Execution,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BootstrapFact {
    pub network: String,
    pub beacon: String,
    pub slot: u64,
    pub committee: String,
    pub execution: ExecutionFact,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct UpdateFact {
    pub network: String,
    pub committee: String,
    pub attested_slot: u64,
    pub signature_slot: u64,
    pub finalized_slot: u64,
    pub finalized_root: String,
    pub next_committee: Option<String>,
    pub execution: ExecutionFact,
}
impl Bootstrap {
    pub fn check(&self) -> Result<BootstrapFact> {
        self.network.validate()?;
        let fork = self.network.fork(self.header.slot)?;
        let committee = self.committee.root()?;
        branch(
            committee,
            &self.committee_branch,
            if fork.electra { 86 } else { 54 },
            bytes(&self.header.state_root)?,
        )?;
        Ok(BootstrapFact {
            network: self.network.root(),
            beacon: hex(self.header.root()?),
            slot: self.header.slot,
            committee: hex(committee),
            execution: self.execution.check(&self.header)?,
        })
    }
}
impl Update {
    #[cfg(feature = "bls")]
    pub fn check(&self) -> Result<UpdateFact> {
        use blst::{min_pk::*, BLST_ERROR};
        self.network.validate()?;
        ensure(
            self.signature_slot > self.attested.slot
                && self.attested.slot >= self.finalized.slot
                && self.finalized.slot > 0,
            "Update slot order",
        )?;
        let fork = self.network.fork(self.attested.slot)?;
        let committee = self.committee.root()?;
        let bits = bytes::<64>(&self.bits)?;
        let count = bits.iter().map(|b| b.count_ones()).sum::<u32>();
        ensure(count >= 342, "Sync committee lacks supermajority")?;
        branch(
            self.finalized.root()?,
            &self.finality_branch,
            if fork.electra { 169 } else { 105 },
            bytes(&self.attested.state_root)?,
        )?;
        let next = if let Some(next) = &self.next {
            let root = next.root()?;
            branch(
                root,
                &self.next_branch,
                if fork.electra { 87 } else { 55 },
                bytes(&self.attested.state_root)?,
            )?;
            Some(hex(root))
        } else {
            ensure(
                self.next_branch.is_empty(),
                "Unexpected next committee branch",
            )?;
            None
        };
        let public = self
            .committee
            .pubkeys
            .iter()
            .enumerate()
            .filter(|(i, _)| bits[i / 8] & (1 << (i % 8)) != 0)
            .map(|(_, p)| {
                PublicKey::key_validate(&bytes::<48>(p)?)
                    .map_err(|e| format!("Invalid BLS key: {e:?}"))
            })
            .collect::<Result<Vec<_>>>()?;
        let sig = Signature::sig_validate(&bytes::<96>(&self.signature)?, true)
            .map_err(|e| format!("Invalid BLS signature: {e:?}"))?;
        let aggregate = AggregatePublicKey::aggregate(&public.iter().collect::<Vec<_>>(), false)
            .map_err(|e| format!("BLS aggregate public key: {e:?}"))?
            .to_public_key();
        let public_affine: &blst::blst_p1_affine = (&aggregate).into();
        let signature_affine: &blst::blst_p2_affine = (&sig).into();
        // Use the synchronous pairing API. blst's std aggregate_verify wrapper
        // introduces mpsc/sched_yield even with no-threads; objective/proof WASM
        // has no thread scheduler. Parallelism belongs between independent proofs.
        let mut pairing = blst::Pairing::new(true, b"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_");
        ensure(
            pairing.aggregate(
                public_affine,
                true,
                signature_affine,
                true,
                &self
                    .network
                    .signing_root(&self.attested, self.signature_slot)?,
                &[],
            ) == BLST_ERROR::BLST_SUCCESS,
            "Invalid Ethereum BLS signature",
        )?;
        pairing.commit();
        ensure(pairing.finalverify(None), "Invalid Ethereum BLS signature")?;
        Ok(UpdateFact {
            network: self.network.root(),
            committee: hex(committee),
            attested_slot: self.attested.slot,
            signature_slot: self.signature_slot,
            finalized_slot: self.finalized.slot,
            finalized_root: hex(self.finalized.root()?),
            next_committee: next,
            execution: self.execution.check(&self.finalized)?,
        })
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "fact", deny_unknown_fields)]
pub enum Fact {
    Bootstrap(BootstrapFact),
    Update(UpdateFact),
    Header(ExecutionFact),
    Receipt(ReceiptFact),
    Account(AccountFact),
}
impl Fact {
    pub fn commitment(&self) -> Hash {
        let mut d = b"psibase.ethereum.evidence.v1\0".to_vec();
        d.extend_from_slice(&serde_json::to_vec(self).unwrap());
        hash(&d)
    }
}
mod execution;
pub use execution::*;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", content = "witness", deny_unknown_fields)]
pub enum Witness {
    Bootstrap(Bootstrap),
    Update(Update),
    Header(String),
    Receipt(ReceiptProof),
    Account(AccountProof),
}
impl Witness {
    #[cfg(feature = "bls")]
    pub fn check(&self) -> Result<Fact> {
        match self {
            Self::Bootstrap(w) => Ok(Fact::Bootstrap(w.check()?)),
            Self::Update(w) => Ok(Fact::Update(w.check()?)),
            Self::Header(w) => Ok(Fact::Header(execution_header(w)?)),
            Self::Receipt(w) => Ok(Fact::Receipt(w.check()?)),
            Self::Account(w) => Ok(Fact::Account(w.check()?)),
        }
    }
}
#[cfg(all(test, feature = "bls"))]
mod tests {
    use super::*;
    fn fixture() -> serde_json::Value {
        serde_json::from_str(include_str!(
            "../../../../../demo/ethbridge/relay-fixture.json"
        ))
        .unwrap()
    }
    #[test]
    fn authenticated_evm_and_beacon_facts() {
        let f = fixture();
        for (_, proof) in f["proofs"].as_object().unwrap() {
            let w: Witness = serde_json::from_value(proof["witness"].clone()).unwrap();
            let fact = w.check().unwrap();
            assert_eq!(serde_json::to_value(&fact).unwrap(), proof["fact"]);
            assert_eq!(hex(fact.commitment()), proof["claim"]);
        }
    }
    #[test]
    fn altered_roots_paths_receipts_and_domains_are_rejected() {
        let f = fixture();
        let original: Witness =
            serde_json::from_value(f["proofs"]["deposit_update"]["witness"].clone()).unwrap();
        let Witness::Update(mut u) = original else {
            panic!()
        };
        u.finality_branch[0] = "ff".repeat(32);
        assert!(u.check().is_err());
        let Witness::Update(mut u) =
            serde_json::from_value(f["proofs"]["deposit_update"]["witness"].clone()).unwrap()
        else {
            panic!()
        };
        u.bits = "01".repeat(64);
        assert!(u.check().is_err());
        let Witness::Update(mut u) =
            serde_json::from_value(f["proofs"]["deposit_update"]["witness"].clone()).unwrap()
        else {
            panic!()
        };
        u.network.genesis_root = "aa".repeat(32);
        assert!(u.check().is_err());
        let Witness::Update(mut u) =
            serde_json::from_value(f["proofs"]["deposit_update"]["witness"].clone()).unwrap()
        else {
            panic!()
        };
        u.execution.fields[3] = "aa".repeat(32);
        assert!(u.check().is_err());
        let Witness::Receipt(mut r) =
            serde_json::from_value(f["proofs"]["deposit"]["witness"].clone()).unwrap()
        else {
            panic!()
        };
        r.receipts_root = "ff".repeat(32);
        assert!(r.check().is_err());
        let Witness::Account(mut a) =
            serde_json::from_value(f["proofs"]["account"]["witness"].clone()).unwrap()
        else {
            panic!()
        };
        a.nodes.push(a.nodes[0].clone());
        assert!(a.check().is_err());
    }
}
#[cfg(all(test, feature = "bls"))]
mod mainnet_tests {
    use super::*;
    #[test]
    fn saved_mainnet_fulu_bls_and_execution_roots() {
        let bootstrap: Witness = serde_json::from_str(include_str!(
            "../../../../../demo/ethbridge/mainnet-bootstrap.json"
        ))
        .unwrap();
        let update: Witness = serde_json::from_str(include_str!(
            "../../../../../demo/ethbridge/mainnet-finality.json"
        ))
        .unwrap();
        let Fact::Bootstrap(b) = bootstrap.check().unwrap() else {
            panic!()
        };
        let Fact::Update(u) = update.check().unwrap() else {
            panic!()
        };
        assert_eq!(b.network, u.network);
        assert_eq!(b.committee, u.committee);
        assert_eq!(b.beacon, u.finalized_root);
        assert_eq!(b.execution, u.execution);
    }
}
