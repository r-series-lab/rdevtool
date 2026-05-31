import { invoke } from "@tauri-apps/api/core";

export async function getStoredJson<T>(
  namespace: string,
  key: string,
): Promise<T | null> {
  const value = await invoke<unknown | null>("storage_get_json", {
    namespace,
    key,
  });
  return value == null ? null : (value as T);
}

export async function setStoredJson(
  namespace: string,
  key: string,
  value: unknown,
): Promise<void> {
  await invoke("storage_set_json", {
    namespace,
    key,
    value,
  });
}

export async function deleteStoredJson(
  namespace: string,
  key: string,
): Promise<void> {
  await invoke("storage_delete_json", {
    namespace,
    key,
  });
}
