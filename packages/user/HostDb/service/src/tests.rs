#[cfg(test)]
mod tests {
    use crate::helpers::{
        check_precondition, decode_fixed_hex, hex_encode, parse_batch, replacement_device,
        Precondition, ReadExpect, KEY_LEN, MAX_VALUE_LEN,
    };
    use crate::tables::tables::DeviceRow;
    use psibase::*;

    fn sample_key_hex() -> String {
        hex_encode(&[0xab; KEY_LEN])
    }

    #[test]
    fn uppercase_hex_decodes() {
        let lower = sample_key_hex();
        let upper = lower.to_ascii_uppercase();
        let expected = &[0xab; KEY_LEN][..];
        assert_eq!(
            decode_fixed_hex::<KEY_LEN>(&upper).as_deref(),
            Some(expected)
        );
        assert_eq!(
            decode_fixed_hex::<KEY_LEN>(&lower).as_deref(),
            Some(expected)
        );
    }

    #[test]
    fn expected_hash_rejects_a_stale_read() {
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
    fn batch_parses_precondition() {
        let key = sample_key_hex();
        let ciphertext_hash = sha256(b"ciphertext");
        let hash = hex_encode(&ciphertext_hash.0);
        let value = "+w==";
        let with_hash = format!(
            r#"{{"ops":[{{"duration":"persistent","key":"{key}","value":"{value}","expected":"{hash}"}}]}}"#
        );
        let changes = parse_batch(with_hash.as_bytes()).expect("hash");
        assert_eq!(changes[0].value(), Some(&[0xfb][..]));
        assert_eq!(
            changes[0].expected,
            Precondition::Read(ReadExpect::Hash(ciphertext_hash))
        );

        let absent = format!(
            r#"{{"ops":[{{"duration":"session","key":"{key}","value":null,"expected":null}}]}}"#
        );
        let changes = parse_batch(absent.as_bytes()).expect("absent");
        assert_eq!(changes[0].expected, Precondition::Read(ReadExpect::Absent));

        let unconditional =
            format!(r#"{{"ops":[{{"duration":"persistent","key":"{key}","value":"{value}"}}]}}"#);
        let changes = parse_batch(unconditional.as_bytes()).expect("unconditional");
        assert_eq!(changes[0].expected, Precondition::Unconditional);

        let bad = format!(
            r#"{{"ops":[{{"duration":"persistent","key":"{key}","value":"{value}","expected":"zz"}}]}}"#
        );
        assert!(parse_batch(bad.as_bytes()).is_none());
    }

    #[test]
    fn batch_rejects_an_oversized_value() {
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine;

        let key = sample_key_hex();
        let encoded_value = STANDARD.encode(vec![0u8; MAX_VALUE_LEN + 1]);
        let batch_json = format!(
            r#"{{"ops":[{{"duration":"persistent","key":"{key}","value":"{encoded_value}"}}]}}"#
        );
        assert!(parse_batch(batch_json.as_bytes()).is_none());
    }

    fn device(id: &[u8], store: &[u8]) -> DeviceRow {
        DeviceRow {
            device: id.to_vec(),
            last_seen: 1,
            store: store.to_vec(),
        }
    }

    #[test]
    fn unfinished_collection_moves_the_prefix_to_a_new_id() {
        let next = replacement_device(device(b"old", b"store"), b"new".to_vec());
        assert_eq!(next.device, b"new");
        assert_eq!(next.store, b"store");
        assert_eq!(next.last_seen, 1);
    }
}
