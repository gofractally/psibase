//! Measure Ethereum's actual BLS ciphersuite on the installed Psibase VM.
//! Public synthetic fixture only. This executable is not a relay or bridge.
use blst::{min_pk::*, BLST_ERROR};
use serde_json::json;
use std::time::Instant;
const DST: &[u8] = b"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_";
const MESSAGE: [u8;32] = [7;32];
const FIXTURE: &[u8] = include_bytes!("../fixture.bin");
const KEYS_BYTES: usize = 512*48;
const RECORD_BYTES: usize = 48+96;
#[cfg(target_family="wasm")]
fn cpu_us() -> u64 {
    #[link(wasm_import_module="wasi_snapshot_preview1")]
    extern "C" { fn clock_time_get(id: u32, precision: u64, time: *mut u64) -> u16; }
    let mut nanos=0;
    // WASI process CPU clock, independent of the host platform's clock IDs.
    assert_eq!(unsafe { clock_time_get(2, 1, &mut nanos) }, 0);
    nanos/1000
}
#[cfg(not(target_family="wasm"))]
fn cpu_us() -> u64 {
    let mut t = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    assert_eq!(unsafe { libc::clock_gettime(libc::CLOCK_PROCESS_CPUTIME_ID, &mut t) }, 0);
    t.tv_sec as u64 * 1_000_000 + t.tv_nsec as u64 / 1000
}
#[cfg(not(target_family="wasm"))]
fn generate() {
    let keys: Vec<_> = (0..512u32).map(|i| {
        let mut ikm = [42;32]; ikm[..4].copy_from_slice(&i.to_le_bytes());
        SecretKey::key_gen(&ikm, &[]).unwrap()
    }).collect();
    let pubkeys: Vec<_> = keys.iter().map(|k| k.sk_to_pk()).collect();
    let sigs: Vec<_> = keys.iter().map(|k| k.sign(&MESSAGE, DST, &[])).collect();
    let mut data: Vec<u8> = pubkeys.iter().flat_map(|p| p.to_bytes()).collect();
    for count in [342,512] {
        data.extend_from_slice(&AggregatePublicKey::aggregate(&pubkeys[..count].iter().collect::<Vec<_>>(), true).unwrap().to_public_key().to_bytes());
        data.extend_from_slice(&AggregateSignature::aggregate(&sigs[..count].iter().collect::<Vec<_>>(), true).unwrap().to_signature().to_bytes());
    }
    std::fs::write("experiments/eth-relay/fixture.bin", &data).unwrap();
    println!("Generated public deterministic fixture: {} bytes",data.len());
}
fn main() {
    #[cfg(not(target_family="wasm"))]
    if std::env::args().any(|a| a == "--generate") { generate(); return; }
    let repeats: usize = std::env::args().find_map(|a| a.strip_prefix("--repeats=").map(|s| s.parse().unwrap())).unwrap_or(3);
    assert!((1..=10).contains(&repeats));
    assert_eq!(FIXTURE.len(), KEYS_BYTES+2*RECORD_BYTES);
    for (record,count) in [342,512].into_iter().enumerate() {
        let offset=KEYS_BYTES+record*RECORD_BYTES;
        let aggregate = PublicKey::key_validate(&FIXTURE[offset..offset+48]).unwrap();
        let sig = Signature::sig_validate(&FIXTURE[offset+48..offset+RECORD_BYTES], true).unwrap();
        // A *lower bound*: the caller already has an authenticated aggregate
        // public key. This omits bitfield validation, committee proofs, key
        // decoding/aggregation, SSZ, database access and transaction overhead.
        for repeat in 0..repeats {
            let wall=Instant::now(); let cpu=cpu_us();
            assert_eq!(sig.verify(true, &MESSAGE, DST, &[], &aggregate, true), BLST_ERROR::BLST_SUCCESS);
            println!("ETH_BLS_BENCH {}",json!({"scenario":"preaggregated_signature_only","participants":count,"repeat":repeat,"cpu_us":cpu_us()-cpu,"wall_us":wall.elapsed().as_micros()}));
        }
        for checked in [false,true] {
            for repeat in 0..repeats {
                let wall=Instant::now(); let cpu=cpu_us();
                let pks: Vec<_> = FIXTURE[..count*48].chunks_exact(48).map(|p| {
                    if checked { PublicKey::key_validate(p).unwrap() }
                    else { PublicKey::from_bytes(p).unwrap() }
                }).collect();
                let decode_cpu=cpu_us()-cpu;
                let refs: Vec<_> = pks.iter().collect();
                assert_eq!(sig.fast_aggregate_verify(true, &MESSAGE, DST, &refs), BLST_ERROR::BLST_SUCCESS);
                println!("ETH_BLS_BENCH {}",json!({"scenario":"committee_and_signature","participants":count,"individual_subgroup_checks":checked,"repeat":repeat,"decode_cpu_us":decode_cpu,"cpu_us":cpu_us()-cpu,"wall_us":wall.elapsed().as_micros()}));
            }
        }
        assert_ne!(sig.verify(true, &[8;32], DST, &[], &aggregate, true), BLST_ERROR::BLST_SUCCESS);
        assert_ne!(sig.verify(true, &MESSAGE, b"WRONG_DOMAIN", &[], &aggregate, true), BLST_ERROR::BLST_SUCCESS);
    }
    let mut infinity=[0;96]; infinity[0]=0xc0;
    assert!(Signature::sig_validate(&infinity,true).is_err());
    assert!(Signature::sig_validate(&[0xff;96],true).is_err());
    println!("ETH_BLS_CHECKS {}",json!({"valid_signatures":true,"wrong_message_rejected":true,"wrong_domain_rejected":true,"infinity_rejected":true,"invalid_encoding_rejected":true}));
}
