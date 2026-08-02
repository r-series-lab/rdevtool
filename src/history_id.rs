use uuid::Uuid;

const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;
const SHORT_HASH_MASK: u64 = 0x0000_ffff_ffff_ffff;

pub fn from_seed(kind: &str, seed: &str) -> String {
    let kind = normalized_kind(kind);
    let mut hash = FNV_OFFSET_BASIS;
    for byte in seed.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    format!("{kind}-{:012x}", hash & SHORT_HASH_MASK)
}

pub fn new(kind: &str) -> String {
    from_seed(kind, &Uuid::new_v4().to_string())
}

fn normalized_kind(kind: &str) -> String {
    let normalized = kind
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let normalized = normalized.trim_matches('-');
    if normalized.is_empty() {
        "history".to_string()
    } else {
        normalized.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_short_id_uses_kind_and_twelve_hex_digits() {
        let first = from_seed("build", "operation-cli-build-123");
        let second = from_seed("build", "operation-cli-build-123");

        assert_eq!(first, second);
        assert_eq!(first.len(), "build-".len() + 12);
        assert!(first.starts_with("build-"));
        assert!(
            first["build-".len()..]
                .chars()
                .all(|value| value.is_ascii_hexdigit())
        );
    }

    #[test]
    fn different_seeds_and_kinds_have_different_ids() {
        assert_ne!(from_seed("build", "a"), from_seed("build", "b"));
        assert_ne!(from_seed("build", "a"), from_seed("merge", "a"));
    }
}
