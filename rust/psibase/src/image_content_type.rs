//! On-chain ids for the image MIME types that services accept when storing
//! images in `sites` (e.g. account avatars and token icons).
//!
//! Each service decides which of these ids it accepts.

/// On-chain id for an image MIME type.
pub type ImgContentType = u8;

pub const PNG: ImgContentType = 0;
pub const JPEG: ImgContentType = 1;
pub const WEBP: ImgContentType = 2;
pub const GIF: ImgContentType = 3;

fn normalize(content_type: &str) -> &str {
    content_type
        .split(';')
        .next()
        .unwrap_or(content_type)
        .trim()
}

/// Maps a MIME content-type string to its on-chain id.
pub fn parse(content_type: &str) -> Option<ImgContentType> {
    match normalize(content_type).to_ascii_lowercase().as_str() {
        "image/png" => Some(PNG),
        "image/jpeg" => Some(JPEG),
        "image/webp" => Some(WEBP),
        "image/gif" => Some(GIF),
        _ => None,
    }
}

/// Maps an on-chain content-type id to its MIME string.
pub fn mime(content_type: ImgContentType) -> Option<&'static str> {
    match content_type {
        PNG => Some("image/png"),
        JPEG => Some("image/jpeg"),
        WEBP => Some("image/webp"),
        GIF => Some("image/gif"),
        _ => None,
    }
}

/// Width and height in pixels of a PNG, JPEG, or WebP image, read from its
/// header. Returns `None` if `data` doesn't start with a well-formed header of
/// `content_type`, or if either dimension is zero.
///
/// Browsers allocate memory for an image based on these dimensions, so the
/// parsing is strict: layouts that a decoder might read differently (e.g. JPEG
/// fill bytes or stray data between segments) are rejected rather than
/// interpreted.
pub fn dimensions(content_type: ImgContentType, data: &[u8]) -> Option<(u32, u32)> {
    match content_type {
        PNG => png_dimensions(data),
        JPEG => jpeg_dimensions(data),
        WEBP => webp_dimensions(data),
        _ => None,
    }
    .filter(|&(width, height)| width > 0 && height > 0)
}

fn bytes<const N: usize>(data: &[u8], at: usize) -> Option<[u8; N]> {
    data.get(at..at.checked_add(N)?)?.try_into().ok()
}

fn png_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    // The IHDR chunk (13 bytes of data) must immediately follow the signature
    if bytes(data, 0)? != *b"\x89PNG\r\n\x1a\n"
        || u32::from_be_bytes(bytes(data, 8)?) != 13
        || bytes(data, 12)? != *b"IHDR"
    {
        return None;
    }
    Some((
        u32::from_be_bytes(bytes(data, 16)?),
        u32::from_be_bytes(bytes(data, 20)?),
    ))
}

fn jpeg_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if bytes(data, 0)? != [0xFF, 0xD8] {
        return None;
    }
    let mut pos = 2;
    loop {
        // Each segment must start exactly where the previous one ended, with a
        // single 0xFF and a length. Decoders skip fill bytes, stray data, and
        // length-less markers, so allowing them would let a crafted file show
        // this parser a different frame header than a browser decodes.
        let [prefix, marker] = bytes(data, pos)?;
        if prefix != 0xFF {
            return None;
        }
        let len = u16::from_be_bytes(bytes(data, pos + 2)?) as usize;
        if len < 2 {
            return None;
        }
        match marker {
            // Start of frame: length, precision, height, width
            0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF => {
                let height = u16::from_be_bytes(bytes(data, pos + 5)?);
                let width = u16::from_be_bytes(bytes(data, pos + 7)?);
                return Some((width.into(), height.into()));
            }
            // Tables, restart interval, comments, and application data
            0xC4 | 0xCC | 0xDB | 0xDD | 0xE0..=0xEF | 0xFE => pos += 2 + len,
            _ => return None,
        }
    }
}

fn webp_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if bytes(data, 0)? != *b"RIFF" || bytes(data, 8)? != *b"WEBP" {
        return None;
    }
    let u24 = |at| bytes::<3>(data, at).map(|[a, b, c]| u32::from_le_bytes([a, b, c, 0]));
    match &bytes(data, 12)? {
        // Lossy: frame tag, start code, then 14-bit width and height
        b"VP8 " => {
            if bytes(data, 23)? != [0x9D, 0x01, 0x2A] {
                return None;
            }
            let width = u16::from_le_bytes(bytes(data, 26)?) & 0x3FFF;
            let height = u16::from_le_bytes(bytes(data, 28)?) & 0x3FFF;
            Some((width.into(), height.into()))
        }
        // Lossless: signature, then 14-bit width - 1 and height - 1
        b"VP8L" => {
            if *data.get(20)? != 0x2F {
                return None;
            }
            let bits = u32::from_le_bytes(bytes(data, 21)?);
            Some(((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1))
        }
        // Extended: canvas width - 1 and height - 1, which bound every frame
        b"VP8X" => Some((u24(24)? + 1, u24(27)? + 1)),
        _ => None,
    }
}

#[cfg(test)]
pub(crate) mod test_images {
    /// Header of a PNG image; enough for `dimensions`, though not decodable
    pub fn png(width: u32, height: u32) -> Vec<u8> {
        let mut data = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        data.extend(width.to_be_bytes());
        data.extend(height.to_be_bytes());
        data.extend([8, 6, 0, 0, 0, 0, 0, 0, 0]);
        data
    }

    pub fn jpeg_segment(marker: u8, body: &[u8]) -> Vec<u8> {
        let mut data = vec![0xFF, marker];
        data.extend((body.len() as u16 + 2).to_be_bytes());
        data.extend(body);
        data
    }

    pub fn jpeg_frame(width: u16, height: u16) -> Vec<u8> {
        let mut body = vec![8];
        body.extend(height.to_be_bytes());
        body.extend(width.to_be_bytes());
        body.extend([1, 1, 0x11, 0]);
        jpeg_segment(0xC0, &body)
    }

    /// Header of a JPEG image as browsers encode it
    pub fn jpeg(width: u16, height: u16) -> Vec<u8> {
        let mut data = vec![0xFF, 0xD8];
        data.extend(jpeg_segment(0xE0, b"JFIF\0\x01\x01\0\0\x01\0\x01\0\0"));
        data.extend(jpeg_segment(0xDB, &[0; 65]));
        data.extend(jpeg_frame(width, height));
        data.extend(jpeg_segment(0xC4, &[0; 17]));
        data
    }

    /// Header of a lossless WebP image
    pub fn webp(width: u32, height: u32) -> Vec<u8> {
        let mut data = b"RIFF\0\0\0\0WEBPVP8L\0\0\0\0\x2F".to_vec();
        data.extend(((width - 1) | (height - 1) << 14).to_le_bytes());
        data
    }
}

#[test]
fn reads_dimensions() {
    use test_images::*;

    assert_eq!(dimensions(PNG, &png(256, 128)), Some((256, 128)));
    assert_eq!(dimensions(JPEG, &jpeg(100, 200)), Some((100, 200)));
    assert_eq!(dimensions(WEBP, &webp(16, 9)), Some((16, 9)));

    let mut lossy = b"RIFF\0\0\0\0WEBPVP8 \0\0\0\0\0\0\0\x9D\x01\x2A".to_vec();
    lossy.extend([0x40, 0x41, 0x20, 0x00]); // 320 | scale bits, 32
    assert_eq!(dimensions(WEBP, &lossy), Some((320, 32)));

    let mut extended = b"RIFF\0\0\0\0WEBPVP8X\x0a\0\0\0\x10\0\0\0".to_vec();
    extended.extend([0xFF, 0x00, 0x00, 0x3F, 0x00, 0x00]); // 256 x 64
    assert_eq!(dimensions(WEBP, &extended), Some((256, 64)));
}

#[test]
fn rejects_mismatched_or_malformed_headers() {
    use test_images::*;

    assert_eq!(dimensions(WEBP, &png(1, 1)), None);
    assert_eq!(dimensions(PNG, &jpeg(1, 1)), None);
    assert_eq!(dimensions(PNG, &[1, 2, 3]), None);
    assert_eq!(dimensions(PNG, &png(0, 1)), None);
    assert_eq!(dimensions(GIF, b"GIF89a\x01\0\x01\0"), None);
    assert_eq!(dimensions(PNG, &png(1, 1)[..20]), None);

    // A chunk other than IHDR first
    let mut png_data = png(1, 1);
    png_data[12..16].copy_from_slice(b"tEXt");
    assert_eq!(dimensions(PNG, &png_data), None);
}

#[test]
fn rejects_ambiguous_jpeg_layouts() {
    use test_images::*;

    let soi = [0xFF, 0xD8];

    // A fill byte before the frame header, which decoders skip
    let filled = [&soi[..], &[0xFF], &jpeg_frame(30000, 30000)].concat();
    assert_eq!(dimensions(JPEG, &filled), None);

    // A length-less restart marker followed by bytes a lenient parser would
    // read as a length, landing on a decoy frame header inside a comment that
    // decoders skip before reaching the real (huge) frame header
    let decoy = jpeg_frame(1, 1);
    let comment = jpeg_segment(0xFE, &decoy);
    let crafted = [
        &soi[..],
        &[0xFF, 0xD0, 0x00, 0x06],
        &comment,
        &jpeg_frame(30000, 30000),
    ]
    .concat();
    assert_eq!(dimensions(JPEG, &crafted), None);

    // Stray data between segments
    let stray = [&soi[..], &[0x00], &jpeg_frame(1, 1)].concat();
    assert_eq!(dimensions(JPEG, &stray), None);

    // Start of scan before any frame header
    let scan_first = [&soi[..], &jpeg_segment(0xDA, &[0; 8]), &jpeg_frame(1, 1)].concat();
    assert_eq!(dimensions(JPEG, &scan_first), None);
}

#[test]
fn round_trips() {
    for id in [PNG, JPEG, WEBP, GIF] {
        assert_eq!(parse(mime(id).unwrap()), Some(id));
    }
    assert_eq!(parse("Image/PNG; charset=binary"), Some(PNG));
    assert_eq!(parse("image/svg+xml"), None);
    assert_eq!(mime(4), None);
}
