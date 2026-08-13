use serde::{Deserialize, Serialize};

use crate::storage::Storage;

pub const APP_PREFERENCES_STORAGE_NAMESPACE: &str = "app";
pub const APP_LANGUAGE_PREFERENCE_STORAGE_KEY: &str = "language-preference";
pub const APP_LANGUAGE_PREFERENCE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
pub enum AppLanguagePreference {
    #[serde(rename = "system")]
    System,
    #[serde(rename = "zh-CN")]
    Chinese,
    #[serde(rename = "en-US")]
    English,
}

impl AppLanguagePreference {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "system" => Some(Self::System),
            "zh-CN" => Some(Self::Chinese),
            "en-US" => Some(Self::English),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Chinese => "zh-CN",
            Self::English => "en-US",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLanguagePreferenceRecord {
    pub schema_version: u32,
    pub preference: AppLanguagePreference,
    pub updated_at_ms: u64,
}

impl AppLanguagePreferenceRecord {
    pub fn new(preference: AppLanguagePreference, updated_at_ms: u64) -> Self {
        Self {
            schema_version: APP_LANGUAGE_PREFERENCE_SCHEMA_VERSION,
            preference,
            updated_at_ms,
        }
    }

    fn validate(self) -> Result<Self, String> {
        if self.schema_version != APP_LANGUAGE_PREFERENCE_SCHEMA_VERSION {
            return Err(format!(
                "unsupported app language preference schema version: {}",
                self.schema_version
            ));
        }
        Ok(self)
    }
}

pub fn load_app_language_preference(
    storage: &Storage,
) -> Result<Option<AppLanguagePreferenceRecord>, String> {
    storage
        .get_json(
            APP_PREFERENCES_STORAGE_NAMESPACE,
            APP_LANGUAGE_PREFERENCE_STORAGE_KEY,
        )?
        .map(|value| {
            serde_json::from_value::<AppLanguagePreferenceRecord>(value)
                .map_err(|error| error.to_string())?
                .validate()
        })
        .transpose()
}

pub fn save_app_language_preference(
    storage: &Storage,
    record: AppLanguagePreferenceRecord,
) -> Result<AppLanguagePreferenceRecord, String> {
    let record = record.validate()?;
    let value = storage.update_json(
        APP_PREFERENCES_STORAGE_NAMESPACE,
        APP_LANGUAGE_PREFERENCE_STORAGE_KEY,
        |stored| {
            let existing = stored
                .map(|value| {
                    serde_json::from_value::<AppLanguagePreferenceRecord>(value)
                        .map_err(|error| error.to_string())?
                        .validate()
                })
                .transpose()?;
            let selected = existing
                .filter(|existing| existing.updated_at_ms > record.updated_at_ms)
                .unwrap_or_else(|| record.clone());
            serde_json::to_value(selected).map_err(|error| error.to_string())
        },
    )?;
    serde_json::from_value::<AppLanguagePreferenceRecord>(value)
        .map_err(|error| error.to_string())?
        .validate()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use uuid::Uuid;

    use super::*;

    fn test_storage(label: &str) -> (Storage, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "rdevtool-app-preferences-{label}-{}.sqlite",
            Uuid::new_v4()
        ));
        (Storage::new(path.clone()).unwrap(), path)
    }

    #[test]
    fn round_trips_language_preference() {
        let (storage, path) = test_storage("round-trip");
        let record = AppLanguagePreferenceRecord::new(AppLanguagePreference::English, 42);

        assert_eq!(
            save_app_language_preference(&storage, record.clone()).unwrap(),
            record
        );
        assert_eq!(
            load_app_language_preference(&storage).unwrap(),
            Some(record)
        );

        fs::remove_file(path).ok();
    }

    #[test]
    fn rejects_unknown_schema_versions() {
        let (storage, path) = test_storage("schema");
        let error = save_app_language_preference(
            &storage,
            AppLanguagePreferenceRecord {
                schema_version: 2,
                preference: AppLanguagePreference::System,
                updated_at_ms: 42,
            },
        )
        .unwrap_err();

        assert!(error.contains("schema version"));
        fs::remove_file(path).ok();
    }

    #[test]
    fn does_not_overwrite_a_newer_language_preference() {
        let (storage, path) = test_storage("last-write-wins");
        let newer = AppLanguagePreferenceRecord::new(AppLanguagePreference::English, 100);
        let stale = AppLanguagePreferenceRecord::new(AppLanguagePreference::Chinese, 99);

        save_app_language_preference(&storage, newer.clone()).unwrap();
        assert_eq!(
            save_app_language_preference(&storage, stale).unwrap(),
            newer
        );

        fs::remove_file(path).ok();
    }
}
