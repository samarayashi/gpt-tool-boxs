// Generic concurrent task queue with cancellation and progress reporting.
// Used by both batch delete and batch move-to-project.

export async function runWithQueue({ ids, worker, concurrency, signal, onProgress }) {
  let nextIndex = 0;
  let succeeded = 0;
  let failed = 0;
  const succeededIds = [];

  async function runWorker() {
    while (nextIndex < ids.length && !signal.aborted) {
      const id = ids[nextIndex];
      nextIndex += 1;

      try {
        await worker(id, { signal });
        succeeded += 1;
        succeededIds.push(id);
      } catch (err) {
        if (signal.aborted || isAbortError(err)) {
          break;
        }
        failed += 1;
      }

      onProgress({ processed: succeeded + failed, succeeded, failed });
    }
  }

  const workerCount = Math.min(concurrency, ids.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));

  return {
    succeeded,
    succeededIds,
    failed,
    canceled: signal.aborted,
  };
}

function isAbortError(err) {
  return err?.name === 'AbortError';
}
