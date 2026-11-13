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
/// result must be the dimensions a browser's decoder reads. Each format is
/// parsed exactly as its spec lays it out, up to and including the dimensions,
/// and anything else is rejected: optional constructs the spec permits but a
/// decoder could read differently (e.g. JPEG fill bytes), and malformed data
/// that decoders tolerate (e.g. stray bytes between JPEG segments). Nothing
/// after the dimensions (e.g. PNG chunk CRCs) is checked; a file malformed
/// there fails to decode, which is harmless.
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

/// PNG spec: the signature, then the IHDR chunk, which must come first. IHDR
/// has 13 bytes of data, starting with the width and height, which as PNG
/// four-byte unsigned integers are at most 2^31 - 1.
fn png_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if bytes(data, 0)? != *b"\x89PNG\r\n\x1a\n"
        || u32::from_be_bytes(bytes(data, 8)?) != 13
        || bytes(data, 12)? != *b"IHDR"
    {
        return None;
    }
    let width = u32::from_be_bytes(bytes(data, 16)?);
    let height = u32::from_be_bytes(bytes(data, 20)?);
    (width <= i32::MAX as u32 && height <= i32::MAX as u32).then_some((width, height))
}

/// ITU-T T.81 Annex B (B.2.1): SOI, then any number of table/miscellaneous
/// segments (B.2.4), then the frame header (B.2.2). Each segment is a 0xFF,
/// a marker code, and a 2-byte length that counts itself but not the marker
/// (B.1.1.4).
///
/// B.1.1.2 also allows any number of 0xFF fill bytes before a marker, and
/// decoders additionally skip stray bytes between segments, which the spec
/// forbids. Both are rejected: with either, a crafted file could show this
/// parser a different frame header than the one a decoder reads.
fn jpeg_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if bytes(data, 0)? != [0xFF, 0xD8] {
        return None;
    }
    let mut pos = 2;
    loop {
        let [prefix, marker] = bytes(data, pos)?;
        if prefix != 0xFF {
            return None;
        }
        let len = u16::from_be_bytes(bytes(data, pos + 2)?) as usize;
        let segment = data.get(pos + 4..pos + 2 + len)?;
        match marker {
            // SOFn (B.2.2): precision, height, width, component count, then 3
            // bytes per component. A height of 0 (defined later by a DNL
            // marker) is rejected by `dimensions`.
            0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF => {
                let [_, h1, h0, w1, w0, components] = bytes(segment, 0)?;
                if components == 0 || segment.len() != 6 + 3 * components as usize {
                    return None;
                }
                let width = u16::from_be_bytes([w1, w0]);
                let height = u16::from_be_bytes([h1, h0]);
                return Some((width.into(), height.into()));
            }
            // B.2.4: DHT, DAC, DQT, DRI, APPn, COM
            0xC4 | 0xCC | 0xDB | 0xDD | 0xE0..=0xEF | 0xFE => pos += 2 + len,
            _ => return None,
        }
    }
}

/// RFC 9649: a RIFF header whose size covers the rest of the file, then the
/// first chunk, which is VP8 (lossy), VP8L (lossless), or VP8X (extended). The
/// chunk's size must fit in the file, and its data starts with the dimensions.
fn webp_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    let le32 = |at| bytes(data, at).map(u32::from_le_bytes);
    if bytes(data, 0)? != *b"RIFF"
        || le32(4)? as usize != data.len() - 8
        || bytes(data, 8)? != *b"WEBP"
    {
        return None;
    }
    let chunk = data.get(20..20usize.checked_add(le32(16)? as usize)?)?;
    match &bytes(data, 12)? {
        // RFC 6386 9.1: the 3-byte frame tag of a key frame (bit 0 clear), the
        // start code, then 14-bit width and height, each with 2 scaling bits
        b"VP8 " => {
            let [tag, _, _, 0x9D, 0x01, 0x2A, w0, w1, h0, h1] = bytes(chunk, 0)? else {
                return None;
            };
            if tag & 1 != 0 {
                return None;
            }
            let width = u16::from_le_bytes([w0, w1]) & 0x3FFF;
            let height = u16::from_le_bytes([h0, h1]) & 0x3FFF;
            Some((width.into(), height.into()))
        }
        // Signature, then 14-bit width - 1, 14-bit height - 1, an alpha bit,
        // and a 3-bit version, which must be 0
        b"VP8L" => {
            let [0x2F, b0, b1, b2, b3] = bytes(chunk, 0)? else {
                return None;
            };
            let bits = u32::from_le_bytes([b0, b1, b2, b3]);
            (bits >> 29 == 0).then_some(((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1))
        }
        // Flags and 3 reserved bytes, then 24-bit canvas width - 1 and
        // height - 1, which bound every frame
        b"VP8X" if chunk.len() == 10 => {
            let u24 = |at| bytes::<3>(chunk, at).map(|[a, b, c]| u32::from_le_bytes([a, b, c, 0]));
            Some((u24(4)? + 1, u24(7)? + 1))
        }
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

    /// A WebP file containing one chunk
    pub fn webp_file(fourcc: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut data = b"RIFF".to_vec();
        data.extend((body.len() as u32 + 12).to_le_bytes());
        data.extend(b"WEBP");
        data.extend(fourcc);
        data.extend((body.len() as u32).to_le_bytes());
        data.extend(body);
        data
    }

    /// Header of a lossless WebP image
    pub fn webp(width: u32, height: u32) -> Vec<u8> {
        let mut body = vec![0x2F];
        body.extend(((width - 1) | (height - 1) << 14).to_le_bytes());
        webp_file(b"VP8L", &body)
    }
}

#[test]
fn reads_dimensions() {
    use test_images::*;

    assert_eq!(dimensions(PNG, &png(256, 128)), Some((256, 128)));
    assert_eq!(dimensions(JPEG, &jpeg(100, 200)), Some((100, 200)));
    assert_eq!(dimensions(WEBP, &webp(16, 9)), Some((16, 9)));

    // 320 with scaling bits set, 32
    let lossy = webp_file(b"VP8 ", b"\0\0\0\x9D\x01\x2A\x40\x41\x20\x00");
    assert_eq!(dimensions(WEBP, &lossy), Some((320, 32)));

    // 256 x 64
    let extended = webp_file(b"VP8X", b"\x10\0\0\0\xFF\0\0\x3F\0\0");
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

    // PNG dimensions above 2^31 - 1
    assert_eq!(dimensions(PNG, &png(1 << 31, 1)), None);
    assert_eq!(dimensions(PNG, &png(1, 1 << 31)), None);

    // A JPEG frame header whose length doesn't match its component count, or
    // with no components
    let soi = [0xFF, 0xD8];
    let short_frame = [&soi[..], &jpeg_segment(0xC0, &[8, 0, 1, 0, 1, 1])].concat();
    assert_eq!(dimensions(JPEG, &short_frame), None);
    let no_components = [&soi[..], &jpeg_segment(0xC0, &[8, 0, 1, 0, 1, 0])].concat();
    assert_eq!(dimensions(JPEG, &no_components), None);
    // A JPEG segment that runs past the end of the data
    assert_eq!(dimensions(JPEG, &jpeg(1, 1)[..30]), None);
    // A JPEG height of 0, defined later by a DNL marker
    assert_eq!(dimensions(JPEG, &jpeg(1, 0)), None);

    // A RIFF size that doesn't cover exactly the rest of the WebP file
    let mut webp_data = webp(1, 1);
    webp_data.push(0);
    assert_eq!(dimensions(WEBP, &webp_data), None);
    assert_eq!(dimensions(WEBP, &webp(1, 1)[..24]), None);

    // A WebP chunk size that runs past the end of the file
    let mut webp_data = webp(1, 1);
    webp_data[16] = 6;
    assert_eq!(dimensions(WEBP, &webp_data), None);

    // A lossy WebP frame that isn't a key frame
    let lossy = webp_file(b"VP8 ", b"\x01\0\0\x9D\x01\x2A\x01\0\x01\0");
    assert_eq!(dimensions(WEBP, &lossy), None);

    // A lossless WebP with a nonzero version
    let mut lossless = webp(1, 1);
    lossless[24] |= 0x20;
    assert_eq!(dimensions(WEBP, &lossless), None);

    // An extended WebP chunk that isn't 10 bytes
    let extended = webp_file(b"VP8X", b"\x10\0\0\0\0\0\0\0\0\0\0\0");
    assert_eq!(dimensions(WEBP, &extended), None);
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
