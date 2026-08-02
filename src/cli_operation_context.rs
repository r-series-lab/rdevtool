use rdevtool_core::operation::{OperationChainContext, OperationEvent, save_operation_event};
use rdevtool_core::storage::Storage;

pub(crate) const OPERATION_CHAIN_ID_ENV: &str = "RDEVTOOL_OPERATION_CHAIN_ID";
pub(crate) const OPERATION_PARENT_ID_ENV: &str = "RDEVTOOL_OPERATION_PARENT_ID";
pub(crate) const OPERATION_STEP_LABEL_ENV: &str = "RDEVTOOL_OPERATION_STEP_LABEL";
pub(crate) const OPERATION_CHAIN_LABEL_ENV: &str = "RDEVTOOL_OPERATION_CHAIN_LABEL";

fn normalized_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(crate) fn operation_chain_context_from_env() -> Option<OperationChainContext> {
    let context = OperationChainContext {
        chain_id: normalized_env(OPERATION_CHAIN_ID_ENV),
        parent_id: normalized_env(OPERATION_PARENT_ID_ENV),
        step_label: normalized_env(OPERATION_STEP_LABEL_ENV),
        chain_label: normalized_env(OPERATION_CHAIN_LABEL_ENV),
    };
    (context != OperationChainContext::default()).then_some(context)
}

pub(crate) fn save_cli_operation_event(
    storage: &Storage,
    event: OperationEvent,
) -> Result<(), String> {
    let context = operation_chain_context_from_env();
    save_operation_event(storage, &event.with_chain_context(context.as_ref()))
}

#[cfg(test)]
mod tests {
    use rdevtool_core::operation::{
        OperationEventOrigin, OperationEventState, lifecycle_operation_event,
    };

    use super::*;

    #[test]
    fn applies_normalized_chain_context_to_an_operation_event() {
        let event = lifecycle_operation_event(
            "operation-1".to_string(),
            OperationEventOrigin::Cli,
            "feature-a".to_string(),
            "runtime",
            "start",
            OperationEventState::Success,
            "启动",
            "已启动",
            "",
            Some("admin"),
            Some("管理端"),
            None,
        )
        .with_chain_context(Some(&OperationChainContext {
            chain_id: Some(" workspace-chain:delivery:cli-1 ".to_string()),
            parent_id: Some(" ".to_string()),
            step_label: Some(" 启动项目 ".to_string()),
            chain_label: Some(" 发布流程 ".to_string()),
        }));

        assert_eq!(
            event.chain_id.as_deref(),
            Some("workspace-chain:delivery:cli-1")
        );
        assert_eq!(event.parent_id, None);
        assert_eq!(event.step_label.as_deref(), Some("启动项目"));
        assert_eq!(event.chain_label.as_deref(), Some("发布流程"));
    }
}
