#[derive(Debug, PartialEq)]
enum ConversionError {
    InvalidNumber,
    InvalidPrecision,
    PrecisionOverflow,
}

pub fn convert_to_u64(
    number: &str,
    precision: u8,
    validate_precision: bool,
) -> Result<u64, ConversionError> {
    let parts: Vec<&str> = number.split('.').collect();

    if parts.len() > 2 {
        return Err(ConversionError::InvalidNumber);
    }
    if precision > 8 {
        return Err(ConversionError::InvalidPrecision);
    }

    let integer_part: u64 = parts[0]
        .parse()
        .map_err(|_| ConversionError::InvalidNumber)?;

    let fractional_value: u64 = if parts.len() > 1 {
        let fraction = parts[1]
            .chars()
            .take(precision as usize)
            .collect::<String>();
        // "24";

        if validate_precision {
            println!("validate precision: {} {}", parts[1].len(), precision);
            if (parts[1].len() as u8) > precision {
                return Err(ConversionError::PrecisionOverflow);
            };
        }

        let remaining_precision = precision - (fraction.len() as u8);

        let fraction_num: u64 = fraction.parse().expect("expected number");

        fraction_num * (10 as u64).pow(remaining_precision as u32)
    } else {
        0
    };

    let integer_value = integer_part * (10 as u64).pow(precision as u32);
    let the_num: u64 = integer_value + (fractional_value);

    return Ok(the_num);
}
