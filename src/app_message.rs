use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

/// Stable application-owned message metadata for presentation-layer localization.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppMessage {
    pub key: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, Value>,
}

impl AppMessage {
    pub fn new(key: impl Into<String>) -> Self {
        Self {
            key: key.into(),
            params: BTreeMap::new(),
        }
    }

    pub fn with_param(mut self, key: impl Into<String>, value: impl Into<Value>) -> Self {
        self.params.insert(key.into(), value.into());
        self
    }
}

#[cfg(test)]
mod tests {
    use super::AppMessage;

    #[test]
    fn serializes_stable_key_and_ordered_params() {
        let message = AppMessage::new("health.snapshot.warning")
            .with_param("count", 2)
            .with_param("scope", "local");

        assert_eq!(
            serde_json::to_value(message).expect("serialize message"),
            serde_json::json!({
                "key": "health.snapshot.warning",
                "params": {
                    "count": 2,
                    "scope": "local"
                }
            })
        );
    }

    #[test]
    fn omits_empty_params() {
        assert_eq!(
            serde_json::to_value(AppMessage::new("health.snapshot.ok")).expect("serialize message"),
            serde_json::json!({ "key": "health.snapshot.ok" })
        );
    }
}
