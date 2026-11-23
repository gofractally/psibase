//! Context-free Ethereum evidence verification. This service reads/writes no
//! database and makes no calls. A verified claim alone grants no authority:
//! objective consumers must match its network, anchor, facts and replay state.
#[psibase::service(name = "verify-eth")]
#[allow(non_snake_case)]
pub mod service {
    use psibase::*;

    #[action]
    #[allow(unused_variables)]
    fn verifySys(transactionHash: Checksum256, claim: Claim, proof: Vec<u8>) {
        assert_eq!(claim.service, Wrapper::SERVICE, "Wrong Ethereum verifier");
        assert_eq!(claim.rawData.len(), 32, "Evidence commitment size");
        assert!(
            proof.len() <= ethrelay_core::MAX_WITNESS,
            "Ethereum witness size limit"
        );
        let witness: ethrelay_core::Witness =
            serde_json::from_slice(&proof).expect("Invalid Ethereum witness");
        let fact = witness.check().unwrap_or_else(|e| abort_message(&e));
        assert_eq!(
            claim.rawData,
            fact.commitment(),
            "Ethereum evidence commitment mismatch"
        );
    }
}
