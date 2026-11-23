use super::Dimensions;
use std::ops::Range;

const WORD_BYTES: usize = std::mem::size_of::<u32>();
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
const PNG_WIDTH_OFFSET: usize = 16;
const PNG_HEIGHT_OFFSET: usize = 20;
const GIF_SIGNATURE: &[u8] = b"GIF8";
const GIF_WIDTH_OFFSET: usize = 6;
const GIF_HEIGHT_OFFSET: usize = 8;
const BMP_SIGNATURE: &[u8] = b"BM";
const BMP_WIDTH_OFFSET: usize = 18;
const BMP_HEIGHT_OFFSET: usize = 22;
const ICO_SIGNATURE: &[u8] = b"\x00\x00\x01\x00";
const ICO_WIDTH_OFFSET: usize = 6;
const ICO_HEIGHT_OFFSET: usize = 7;
const ICO_FULL_SIZE: u32 = 256;
const JPEG_SIGNATURE: &[u8] = b"\xff\xd8";
const JPEG_FIRST_MARKER: usize = 2;
const JPEG_MARKER_PREFIX: u8 = 0xff;
const JPEG_MARKER_BYTES: usize = 2;
const JPEG_LENGTH_OFFSET: usize = 2;
const JPEG_MIN_SEGMENT_LENGTH: u16 = 2;
const JPEG_HEIGHT_OFFSET: usize = 5;
const JPEG_WIDTH_OFFSET: usize = 7;
const RIFF_SIGNATURE: &[u8] = b"RIFF";
const WEBP_FORM: &[u8] = b"WEBP";
const WEBP_FORM_RANGE: Range<usize> = 8..12;
const WEBP_CHUNK_RANGE: Range<usize> = 12..16;
const VP8X_WIDTH_OFFSET: usize = 24;
const VP8X_HEIGHT_OFFSET: usize = 27;
const VP8L_PACKED_OFFSET: usize = 21;
const VP8L_HEIGHT_SHIFT: u32 = 14;
const VP8_WIDTH_OFFSET: usize = 26;
const VP8_HEIGHT_OFFSET: usize = 28;
const FOURTEEN_BIT_MASK: u32 = 0x3fff;

fn be16(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_be_bytes([
        *bytes.get(offset)?,
        *bytes.get(offset + 1)?,
    ]))
}
fn le16(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u16::from_le_bytes([*bytes.get(offset)?, *bytes.get(offset + 1)?]).into())
}
fn word(bytes: &[u8], offset: usize) -> Option<[u8; WORD_BYTES]> {
    bytes.get(offset..offset + WORD_BYTES)?.try_into().ok()
}
fn be32(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_be_bytes(word(bytes, offset)?))
}
fn le32(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(word(bytes, offset)?))
}
fn le_signed32(bytes: &[u8], offset: usize) -> Option<i32> {
    Some(i32::from_le_bytes(word(bytes, offset)?))
}
fn le24(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes([
        *bytes.get(offset)?,
        *bytes.get(offset + 1)?,
        *bytes.get(offset + 2)?,
        0,
    ]))
}
fn is_standalone_marker(marker: u8) -> bool {
    matches!(marker, 0xff | 0x00 | 0x01 | 0xd0..=0xd9)
}
fn is_start_of_frame(marker: u8) -> bool {
    matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf)
}
fn jpeg_frame_dimensions(bytes: &[u8], offset: usize) -> Option<Dimensions> {
    Some(Dimensions {
        width: be16(bytes, offset + JPEG_WIDTH_OFFSET)?.into(),
        height: be16(bytes, offset + JPEG_HEIGHT_OFFSET)?.into(),
    })
}
fn jpeg_segment_end(bytes: &[u8], offset: usize) -> Option<usize> {
    let length = be16(bytes, offset + JPEG_LENGTH_OFFSET)?.max(JPEG_MIN_SEGMENT_LENGTH);
    Some(offset + JPEG_MARKER_BYTES + usize::from(length))
}
fn jpeg_dimensions(bytes: &[u8]) -> Option<Dimensions> {
    let mut offset = JPEG_FIRST_MARKER;
    while offset + 1 < bytes.len() {
        if bytes[offset] != JPEG_MARKER_PREFIX {
            offset += 1;
            continue;
        }
        let marker = bytes[offset + 1];
        if is_standalone_marker(marker) {
            offset += JPEG_MARKER_BYTES;
            continue;
        }
        if is_start_of_frame(marker) {
            return jpeg_frame_dimensions(bytes, offset);
        }
        offset = jpeg_segment_end(bytes, offset)?;
    }
    None
}
fn vp8l_dimensions(bytes: &[u8]) -> Option<Dimensions> {
    let packed = le32(bytes, VP8L_PACKED_OFFSET)?;
    Some(Dimensions {
        width: (packed & FOURTEEN_BIT_MASK) + 1,
        height: ((packed >> VP8L_HEIGHT_SHIFT) & FOURTEEN_BIT_MASK) + 1,
    })
}
fn webp_dimensions(bytes: &[u8]) -> Option<Dimensions> {
    match bytes.get(WEBP_CHUNK_RANGE)? {
        b"VP8X" => Some(Dimensions {
            width: le24(bytes, VP8X_WIDTH_OFFSET)? + 1,
            height: le24(bytes, VP8X_HEIGHT_OFFSET)? + 1,
        }),
        b"VP8L" => vp8l_dimensions(bytes),
        b"VP8 " => Some(Dimensions {
            width: le16(bytes, VP8_WIDTH_OFFSET)? & FOURTEEN_BIT_MASK,
            height: le16(bytes, VP8_HEIGHT_OFFSET)? & FOURTEEN_BIT_MASK,
        }),
        _ => None,
    }
}
fn ico_size(value: u8) -> u32 {
    if value == 0 {
        return ICO_FULL_SIZE;
    }
    value.into()
}
fn is_webp(bytes: &[u8]) -> bool {
    let has_webp_form = bytes.get(WEBP_FORM_RANGE) == Some(WEBP_FORM);
    bytes.starts_with(RIFF_SIGNATURE) && has_webp_form
}
pub fn dimensions(bytes: &[u8]) -> Option<Dimensions> {
    if bytes.starts_with(PNG_SIGNATURE) {
        return Some(Dimensions {
            width: be32(bytes, PNG_WIDTH_OFFSET)?,
            height: be32(bytes, PNG_HEIGHT_OFFSET)?,
        });
    }
    if bytes.starts_with(GIF_SIGNATURE) {
        return Some(Dimensions {
            width: le16(bytes, GIF_WIDTH_OFFSET)?,
            height: le16(bytes, GIF_HEIGHT_OFFSET)?,
        });
    }
    if bytes.starts_with(BMP_SIGNATURE) {
        return Some(Dimensions {
            width: le_signed32(bytes, BMP_WIDTH_OFFSET)?.unsigned_abs(),
            height: le_signed32(bytes, BMP_HEIGHT_OFFSET)?.unsigned_abs(),
        });
    }
    if bytes.starts_with(ICO_SIGNATURE) {
        return Some(Dimensions {
            width: ico_size(*bytes.get(ICO_WIDTH_OFFSET)?),
            height: ico_size(*bytes.get(ICO_HEIGHT_OFFSET)?),
        });
    }
    if bytes.starts_with(JPEG_SIGNATURE) {
        return jpeg_dimensions(bytes);
    }
    if is_webp(bytes) {
        return webp_dimensions(bytes);
    }
    None
}
