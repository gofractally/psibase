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

#[test]
fn round_trips() {
    for id in [PNG, JPEG, WEBP, GIF] {
        assert_eq!(parse(mime(id).unwrap()), Some(id));
    }
    assert_eq!(parse("Image/PNG; charset=binary"), Some(PNG));
    assert_eq!(parse("image/svg+xml"), None);
    assert_eq!(mime(4), None);
}
