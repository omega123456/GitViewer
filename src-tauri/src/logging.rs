use chrono::{Duration, NaiveDate, Utc};
use std::path::Path;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{filter::Targets, fmt::writer::MakeWriterExt, layer::SubscriberExt};

pub fn cleanup(directory: &Path, today: NaiveDate) -> std::io::Result<()> {
    for entry in std::fs::read_dir(directory)? {
        let path = entry?.path();
        let date = path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_prefix("gitviewer.")?.strip_suffix(".log"))
            .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok());
        if date.is_some_and(|date| date < today - Duration::days(7)) {
            std::fs::remove_file(path)?;
        }
    }
    Ok(())
}

pub struct Guard(std::sync::Mutex<Option<WorkerGuard>>);

impl Guard {
    pub fn flush(&self) {
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take();
    }
}

pub fn init(directory: &Path) -> Result<Guard, Box<dyn std::error::Error>> {
    std::fs::create_dir_all(directory)?;
    cleanup(directory, Utc::now().date_naive())?;
    let appender = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("gitviewer")
        .filename_suffix("log")
        .build(directory)?;
    let (writer, guard) = tracing_appender::non_blocking(appender);
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .with_max_level(tracing::Level::INFO)
        .with_writer(writer.and(std::io::stdout))
        .finish()
        .with(
            Targets::new()
                .with_target("async_openai", tracing::level_filters::LevelFilter::OFF)
                .with_default(tracing::Level::INFO),
        );
    tracing::subscriber::set_global_default(subscriber)?;
    Ok(Guard(std::sync::Mutex::new(Some(guard))))
}
