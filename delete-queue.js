import { DELETE_CONCURRENCY, deleteConversation } from './chatgpt-api.js';

export async function deleteWithQueue({ ids, token, signal, onProgress }) {
  let nextIndex = 0;
  let deleted = 0;
  let failed = 0;
  const deletedIds = [];

  async function worker() {
    while (nextIndex < ids.length && !signal.aborted) {
      const id = ids[nextIndex];
      nextIndex += 1;

      try {
        await deleteConversation(token, id, { signal });
        deleted += 1;
        deletedIds.push(id);
      } catch (err) {
        if (signal.aborted || isAbortError(err)) {
          break;
        }
        failed += 1;
      }

      onProgress({ processed: deleted + failed, deleted, failed });
    }
  }

  const workerCount = Math.min(DELETE_CONCURRENCY, ids.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  return {
    deleted,
    deletedIds,
    failed,
    canceled: signal.aborted,
  };
}

function isAbortError(err) {
  return err?.name === 'AbortError';
}
