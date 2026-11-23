const EXTENSION_SEPARATOR: char = '.';
const TEXT_MIME: &str = "text/plain; charset=utf-8";

pub struct ImageType {
    pub extension: &'static str,
    pub mime: &'static str,
}
pub static IMAGE_TYPES: [ImageType; 9] = [
    ImageType {
        extension: "png",
        mime: "image/png",
    },
    ImageType {
        extension: "jpg",
        mime: "image/jpeg",
    },
    ImageType {
        extension: "jpeg",
        mime: "image/jpeg",
    },
    ImageType {
        extension: "gif",
        mime: "image/gif",
    },
    ImageType {
        extension: "webp",
        mime: "image/webp",
    },
    ImageType {
        extension: "bmp",
        mime: "image/bmp",
    },
    ImageType {
        extension: "ico",
        mime: "image/x-icon",
    },
    ImageType {
        extension: "svg",
        mime: "image/svg+xml",
    },
    ImageType {
        extension: "avif",
        mime: "image/avif",
    },
];

pub fn extension_of(path: &str) -> String {
    path.rsplit(EXTENSION_SEPARATOR)
        .next()
        .unwrap_or_default()
        .to_lowercase()
}
fn image_type(path: &str) -> Option<&'static ImageType> {
    let extension = extension_of(path);
    IMAGE_TYPES
        .iter()
        .find(|image| image.extension == extension)
}
pub fn is_image(path: &str) -> bool {
    image_type(path).is_some()
}
pub fn mime(path: &str) -> &'static str {
    image_type(path).map_or(TEXT_MIME, |image| image.mime)
}
