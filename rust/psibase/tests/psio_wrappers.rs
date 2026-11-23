//! The PSIO forms of the wrapper types: `Memo`, `Precision`, `Quantity` and
//! `Decimal` in pSSZ, key (not `Memo`) and I-JSON, and the rejection of what
//! is not a value. The vectors are the ones the C++ tests pin for the same types
//! (`libraries/psibase/common/tests/wrappers.cpp`).

use psibase::fracpack::{Pack, Unpack};
use psibase::services::tokens::{Decimal, Precision, Quantity};
use psibase::Memo;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn decimal(quantity: u64, precision: u8) -> Decimal {
    Decimal::new(Quantity::new(quantity), Precision::new(precision).unwrap())
}

// ── Memo ────────────────────────────────────────────────────────────────────

#[test]
fn memo_is_its_text_in_pssz_and_ijson() {
    let memo = Memo::new("h\u{e9}llo".to_string()).unwrap();
    let text = "h\u{e9}llo".to_string();
    assert_eq!(psio::to_pssz(&memo), psio::to_pssz(&text));
    assert_eq!(psio::to_ijson(&memo), psio::to_ijson(&text));
    assert_eq!(psio::to_ijson(&memo), "\"h\u{e9}llo\"");
    assert_eq!(
        psio::from_pssz::<Memo>(&psio::to_pssz(&memo))
            .unwrap()
            .to_string(),
        text
    );
    // In a record it takes the place of a string.
    assert_eq!(
        psio::to_pssz(&(7u8, memo.clone())),
        psio::to_pssz(&(7u8, psio::pssz::BoundedString::<80>(text.clone())))
    );
}

#[test]
fn text_that_is_not_a_memo_is_rejected_by_every_reader_and_writer() {
    let long = "a".repeat(81);
    assert!(psio::validate_pssz::<Memo>(&psio::to_pssz(&"a".repeat(80))).is_ok());
    assert!(psio::validate_pssz::<Memo>(&psio::to_pssz(&long)).is_err());
    assert!(psio::from_pssz::<Memo>(&psio::to_pssz(&long)).is_err());
    // Not UTF-8.
    assert!(psio::validate_pssz::<Memo>(&[0xff, 0xfe]).is_err());
    // Inside a record too.
    type Args = (u32, Memo);
    assert!(psio::validate_pssz::<Args>(&psio::to_pssz(&(1u32, Memo::from("ok")))).is_ok());

    assert!(psio::from_ijson::<Memo>("\"hello\"").is_ok());
    assert!(psio::from_ijson::<Memo>(&format!("\"{long}\"")).is_err());
    assert!(psio::from_ijson::<Memo>("{\"contents\":\"hello\"}").is_err());
}

// ── Precision ───────────────────────────────────────────────────────────────

#[test]
fn precision_is_its_number_0_to_8() {
    let p = Precision::new(4).unwrap();
    assert_eq!(hex(&psio::to_pssz(&p)), "04");
    assert_eq!(hex(&psio::to_key(&p)), "04");
    assert_eq!(psio::to_ijson(&p), "4");
    assert_eq!(psio::from_pssz::<Precision>(&[8]).unwrap().value(), 8);
    assert!(psio::validate_pssz::<Precision>(&[9]).is_err());
    assert!(psio::from_ijson::<Precision>("8").is_ok());
    assert!(psio::from_ijson::<Precision>("9").is_err());
    // The rejection names the number.
    let why = psio::from_pssz::<Precision>(&[9]).unwrap_err();
    assert!(
        format!("{why:?}").contains("Value 9 outside allowed Precision range: 0 to 8"),
        "{why:?}"
    );
    let why = psio::from_ijson::<Precision>("200").unwrap_err();
    assert!(
        format!("{why:?}").contains("Value 200 outside allowed Precision range: 0 to 8"),
        "{why:?}"
    );
}

// ── Quantity and Decimal ────────────────────────────────────────────────────

#[test]
fn decimal_is_a_record_whose_text_is_the_decimal_number() {
    let d = decimal(1234567, 4);
    // The record (quantity, precision); the precision in it is its number.
    assert_eq!(
        psio::to_pssz(&d),
        psio::to_pssz(&(Quantity::new(1234567), 4u8))
    );
    assert!(psio::validate_pssz::<Decimal>(&psio::to_pssz(&d)).is_ok());
    assert_eq!(
        psio::from_pssz::<Decimal>(&psio::to_pssz(&d))
            .unwrap()
            .to_string(),
        "123.4567"
    );
    assert!(psio::validate_pssz::<Decimal>(&psio::to_pssz(&(Quantity::new(1), 9u8))).is_err());
    assert_eq!(psio::to_ijson(&d), "\"123.4567\"");
    let back = psio::from_ijson::<Decimal>("\"0.50\"").unwrap();
    assert_eq!((back.quantity.value, back.precision.value()), (50, 2));

    // Every spelling C++ `Decimal::fromStr` reads...
    for text in [
        "0",
        "40000",
        "400.00",
        "0.12345678",
        ".5",
        "5.",
        "007.10",
        "18446744073709551615",
        "184467440737.09551615",
    ] {
        assert!(text.parse::<Decimal>().is_ok(), "{text}");
        assert!(
            psio::from_ijson::<Decimal>(&format!("\"{text}\"")).is_ok(),
            "{text}"
        );
    }
    // ...and nothing else.
    for text in [
        "",
        ".",
        "1.2.3",
        "-1",
        "+1",
        "1e3",
        " 1",
        "1 ",
        "0.123456789",
        "18446744073709551616",
        "184467440737.09551616",
        "1844674407371.00000000",
    ] {
        assert!(text.parse::<Decimal>().is_err(), "{text:?} was read");
        assert!(
            psio::from_ijson::<Decimal>(&format!("\"{text}\"")).is_err(),
            "{text:?} was read"
        );
    }
    assert!(psio::from_ijson::<Decimal>("{\"quantity\":1,\"precision\":0}").is_err());
}

#[test]
fn a_decimal_whose_quantity_does_not_fit_64_bits_is_rejected_not_wrapped() {
    let boundaries = [
        (0, "18446744073709551615", "18446744073709551616"),
        (1, "1844674407370955161.5", "1844674407370955161.6"),
        (2, "184467440737095516.15", "184467440737095516.16"),
        (4, "1844674407370955.1615", "1844674407370955.1616"),
        (7, "1844674407370.9551615", "1844674407370.9551616"),
        (8, "184467440737.09551615", "184467440737.09551616"),
    ];
    for (precision, largest, next) in boundaries {
        // The largest quantity is read, by every reader, as itself.
        assert_eq!(decimal(u64::MAX, precision).to_string(), largest);
        let read: Decimal = largest.parse().unwrap();
        assert_eq!(
            (read.quantity.value, read.precision.value()),
            (u64::MAX, precision)
        );
        let read = psio::from_ijson::<Decimal>(&format!("\"{largest}\"")).unwrap();
        assert_eq!(
            (read.quantity.value, read.precision.value()),
            (u64::MAX, precision)
        );
        let read: Decimal = serde_json::from_str(&format!("\"{largest}\"")).unwrap();
        assert_eq!(
            (read.quantity.value, read.precision.value()),
            (u64::MAX, precision)
        );
        // One more is not a Decimal.
        assert!(next.parse::<Decimal>().is_err(), "{next} was read");
        assert!(psio::from_ijson::<Decimal>(&format!("\"{next}\"")).is_err());
        assert!(serde_json::from_str::<Decimal>(&format!("\"{next}\"")).is_err());
    }
    // Further out: the integer part alone, or a carry out of the fraction.
    for text in [
        "184467440738.00000000",
        "184467440737.99999999",
        "1844674407370955162.0",
        "99999999999999999999.9",
    ] {
        assert!(text.parse::<Decimal>().is_err(), "{text} was read");
        assert!(psio::from_ijson::<Decimal>(&format!("\"{text}\"")).is_err());
    }
    // The packed form has no such value: every 64-bit quantity is one.
    assert!(psio::validate_pssz::<Decimal>(&psio::to_pssz(&decimal(u64::MAX, 8))).is_ok());
}

// ── The forms in use are untouched ──────────────────────────────────────────

#[test]
fn the_packed_and_json_forms_in_use_are_unchanged() {
    // fracpack still writes every byte psibase stores and sends.
    assert_eq!(hex(&Memo::from("hi").packed()), "020000006869");
    assert!(Memo::unpacked(&"a".repeat(81).packed()).is_err());
    assert_eq!(hex(&Precision::new(4).unwrap().packed()), "04");
    assert!(Precision::unpacked(&[9]).is_err());
    assert_eq!(hex(&Quantity::new(5).packed()), "08000500000000000000");
    // serde, which the services and the CLI use.
    assert_eq!(serde_json::to_string(&Memo::from("hi")).unwrap(), "\"hi\"");
    assert_eq!(
        serde_json::to_string(&Precision::new(4).unwrap()).unwrap(),
        "4"
    );
    assert_eq!(serde_json::to_string(&decimal(15, 1)).unwrap(), "\"1.5\"");
    assert_eq!(
        serde_json::to_string(&Quantity::new(5)).unwrap(),
        "{\"value\":5}"
    );
}
