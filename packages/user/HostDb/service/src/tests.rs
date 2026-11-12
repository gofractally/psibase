#[cfg(test)]
mod tests {
    use crate::helpers::{
        check_precondition, decode_fixed_hex, hex_encode, parse_batch, ReadExpect, Precondition,
        KEY_LEN,
    };
    use psibase::*;

    #[test]
    fn uppercase_hex_decodes() {
        let bytes = [0xab; KEY_LEN];
        let upper = Hex(bytes).to_string();
        let lower = upper.to_ascii_lowercase();
        let expected = bytes.to_vec();
        assert_eq!(decode_fixed_hex::<KEY_LEN>(&upper), Some(expected.clone()));
        assert_eq!(decode_fixed_hex::<KEY_LEN>(&lower), Some(expected));
    }

    #[test]
    fn expected_hash_rejects_a_stale_read() {
        assert_eq!(
            hex_encode(&sha256(b"").0),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        let stored = b"ciphertext-v2";
        let stale = sha256(b"ciphertext-v1");
        assert_eq!(
            check_precondition(Some(stored), &ReadExpect::Hash(stale)),
            Err(409)
        );
        assert_eq!(
            check_precondition(Some(stored), &ReadExpect::Hash(sha256(stored))),
            Ok(())
        );
        assert_eq!(
            check_precondition(None, &ReadExpect::Hash(sha256(stored))),
            Err(409)
        );
        assert_eq!(
            check_precondition(Some(stored), &ReadExpect::Absent),
            Err(409)
        );
        assert_eq!(check_precondition(None, &ReadExpect::Absent), Ok(()));
    }

    #[test]
    fn batch_op_parses_expected_hash() {
        let key = "ab".repeat(32);
        let hash = hex_encode(&sha256(b"ciphertext").0);
        let with_hash = format!(
            r#"{{"ops":[{{"duration":"persistent","key":"{key}","value":"YQ","expected":"{hash}"}}]}}"#
        );
        let changes = parse_batch(with_hash.as_bytes()).expect("hash");
        assert_eq!(
            changes[0].expected,
            Precondition::Read(ReadExpect::Hash(sha256(b"ciphertext")))
        );

        let absent = format!(
            r#"{{"ops":[{{"duration":"session","key":"{key}","value":null,"expected":null}}]}}"#
        );
        let changes = parse_batch(absent.as_bytes()).expect("absent");
        assert_eq!(changes[0].expected, Precondition::Read(ReadExpect::Absent));

        let unconditional =
            format!(r#"{{"ops":[{{"duration":"persistent","key":"{key}","value":"YQ"}}]}}"#);
        let changes = parse_batch(unconditional.as_bytes()).expect("unconditional");
        assert_eq!(changes[0].expected, Precondition::Unconditional);

        let bad = format!(
            r#"{{"ops":[{{"duration":"persistent","key":"{key}","value":"YQ","expected":"zz"}}]}}"#
        );
        assert!(parse_batch(bad.as_bytes()).is_none());
    }
}
