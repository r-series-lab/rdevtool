import { invoke } from "@tauri-apps/api/core";

const storageWriteQueues = new Map<string, Promise<unknown>>();

function enqueueStorageWrite<T>(
  namespace: string,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const queueKey = `${namespace}\u0000${key}`;
  const previous = storageWriteQueues.get(queueKey) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  storageWriteQueues.set(queueKey, next);
  const release = () => {
    if (storageWriteQueues.get(queueKey) === next) {
      storageWriteQueues.delete(queueKey);
    }
  };
  void next.then(release, release);
  return next;
}

export async function prependStoredJsonArray<T>(
  namespace: string,
  key: string,
  value: T,
  limit: number,
): Promise<T[]> {
  return enqueueStorageWrite(namespace, key, () =>
    invoke<T[]>("storage_prepend_json_array", {
      namespace,
      key,
      value,
      limit,
    }),
  );
}

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
  await enqueueStorageWrite(namespace, key, () =>
    invoke("storage_set_json", {
      namespace,
      key,
      value,
    }),
  );
}

export async function deleteStoredJson(
  namespace: string,
  key: string,
): Promise<void> {
  await enqueueStorageWrite(namespace, key, () =>
    invoke("storage_delete_json", {
      namespace,
      key,
    }),
  );
}
