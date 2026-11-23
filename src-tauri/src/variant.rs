use crate::error::{Error, Result};
use serde::de::{value::StrDeserializer, DeserializeOwned, IntoDeserializer};

pub fn parse<T: DeserializeOwned>(name: &str, unknown: &str) -> Result<T> {
    let deserializer: StrDeserializer<'_, serde::de::value::Error> = name.into_deserializer();
    T::deserialize(deserializer).map_err(|_| Error::refused(unknown))
}
