import {
  PAGE_SIZE,
  fetchConversations,
  getAccessToken,
} from './chatgpt-api.js';
import { deleteWithQueue } from './delete-queue.js';
import { openConversationInBackgroundTab } from './tab-navigation.js';
import {
  appendConversationItems,
  els,
  getSearchQuery,
  hideDeleteConfirmation,
  hideStatus,
  renderList,
  setLoadingMessage,
  showDeleteConfirmation,
  showStatus,
  updateToolbar,
  updateTotalInfo,
} from './popup-view.js';

const SCROLL_LOAD_THRESHOLD_PX = 100;
const LOAD_ALL_PAGE_DELAY_MS = 700;

const state = {
  conversations: [],
  filteredConversations: [],
  selectedIds: new Set(),
  isLoading: false,
  isLoadingAll: false,
  isDeleting: false,
  deleteAbortController: null,
  offset: 0,
  hasMore: true,
};

function matchesSearch(conversation, query) {
  return !query || (conversation.title || 'Untitled').toLowerCase().includes(query);
}

function refreshFilteredConversations() {
  const query = getSearchQuery();
  state.filteredConversations = state.conversations.filter((conversation) =>
    matchesSearch(conversation, query)
  );
}

function updateViewState() {
  updateToolbar({
    conversations: state.filteredConversations,
    selectedIds: state.selectedIds,
    hasMore: state.hasMore,
    isLoading: state.isLoading,
    isLoadingAll: state.isLoadingAll,
    isDeleting: state.isDeleting,
  });
  updateTotalInfo({
    visibleCount: state.filteredConversations.length,
    loadedCount: state.conversations.length,
    hasMore: state.hasMore,
    hasQuery: Boolean(getSearchQuery()),
  });
}

function resetConversationState() {
  state.conversations = [];
  state.filteredConversations = [];
  state.selectedIds.clear();
  state.offset = 0;
  state.hasMore = true;
}

function addConversations(items, append) {
  state.conversations = append ? [...state.conversations, ...items] : items;
  state.offset = append ? state.offset + items.length : items.length;
  state.hasMore = items.length === PAGE_SIZE;
  refreshFilteredConversations();
}

function removeConversations(ids) {
  const idSet = new Set(ids);

  state.conversations = state.conversations.filter(
    (conversation) => !idSet.has(conversation.id)
  );
  state.offset = state.conversations.length;
  ids.forEach((id) => state.selectedIds.delete(id));
  refreshFilteredConversations();
}

async function loadConversations({ append = false, preserveStatus = false } = {}) {
  if (state.isLoading || (append && !state.hasMore)) return [];

  state.isLoading = true;

  if (!append) {
    setLoadingMessage('Loading conversations...');
    if (!preserveStatus) {
      hideStatus();
    }
  }

  try {
    const token = await getAccessToken();
    const previousFilteredCount = state.filteredConversations.length;
    const data = await fetchConversations(token, state.offset);
    const items = data.items || [];

    addConversations(items, append);

    if (append) {
      const newVisibleItems = state.filteredConversations.slice(previousFilteredCount);
      if (state.filteredConversations.length === 0) {
        renderList(state.filteredConversations, state.selectedIds);
      } else {
        appendConversationItems(newVisibleItems, state.selectedIds);
      }
    } else {
      renderList(state.filteredConversations, state.selectedIds);
    }

    updateViewState();
    return items;
  } catch (err) {
    if (!append) {
      setLoadingMessage(err.message);
    }
    showStatus(err.message, 'error');
    return null;
  } finally {
    state.isLoading = false;
    updateViewState();
  }
}

async function loadAllConversations() {
  if (!state.hasMore || state.isLoadingAll) return;

  state.isLoadingAll = true;
  showStatus(`Loading all... ${state.conversations.length} loaded`, 'info', {
    autoHide: false,
  });
  updateViewState();

  try {
    while (state.hasMore) {
      const items = await loadConversations({ append: true });
      updateViewState();

      if (items === null) {
        break;
      }

      showStatus(`Loading all... ${state.conversations.length} loaded`, 'info', {
        autoHide: false,
      });

      if (items.length === 0) {
        break;
      }

      if (state.hasMore) {
        await delay(LOAD_ALL_PAGE_DELAY_MS);
      }
    }

    if (!state.hasMore) {
      showStatus(`Loaded ${pluralizeConversation(state.conversations.length)}.`, 'success');
    }
  } finally {
    state.isLoadingAll = false;
    updateViewState();
  }
}

async function handleConversationListClick(event) {
  if (state.isDeleting) return;

  const item = event.target.closest('.conversation-item');
  if (!item) return;

  const checkbox = item.querySelector('input[type="checkbox"]');

  if (event.target === checkbox) {
    setSelection(item.dataset.id, checkbox.checked);
    return;
  }

  try {
    await openConversationInBackgroundTab(item.dataset.id);
    showStatus('Conversation opened in a background tab.', 'success');
  } catch (err) {
    showStatus(err.message, 'error');
  }
}

function setSelection(id, selected) {
  if (selected) {
    state.selectedIds.add(id);
  } else {
    state.selectedIds.delete(id);
  }

  updateViewState();
}

function handleSelectAllChange() {
  if (state.isDeleting) return;

  state.filteredConversations.forEach((conversation) => {
    if (els.selectAll.checked) {
      state.selectedIds.add(conversation.id);
    } else {
      state.selectedIds.delete(conversation.id);
    }
  });

  renderList(state.filteredConversations, state.selectedIds);
  updateViewState();
}

function handleSearchInput() {
  if (state.isDeleting) return;

  refreshFilteredConversations();
  renderList(state.filteredConversations, state.selectedIds);
  updateViewState();
}

function handleListScroll() {
  if (state.isDeleting) return;

  const distanceFromBottom =
    els.list.scrollHeight - els.list.scrollTop - els.list.clientHeight;

  if (distanceFromBottom < SCROLL_LOAD_THRESHOLD_PX) {
    loadConversations({ append: true });
  }
}

function handleDeleteClick() {
  if (state.isDeleting) {
    cancelDelete();
    return;
  }

  if (state.selectedIds.size === 0) return;
  showDeleteConfirmation(state.selectedIds.size);
}

async function performDelete() {
  hideDeleteConfirmation();

  const ids = [...state.selectedIds];
  const totalToDelete = ids.length;
  const abortController = new AbortController();

  state.isDeleting = true;
  state.deleteAbortController = abortController;
  showStatus(`Deleting ${pluralizeConversation(totalToDelete)}...`, 'info', {
    autoHide: false,
  });
  updateViewState();

  try {
    const token = await getAccessToken();
    const result = await deleteWithQueue({
      ids,
      token,
      signal: abortController.signal,
      onProgress: ({ processed }) => {
        showStatus(`Deleting... ${processed}/${totalToDelete}`, 'info', {
          autoHide: false,
        });
      },
    });

    showStatus(getDeleteResultMessage(result), getDeleteResultType(result));

    if (result.deleted > 0) {
      removeConversations(result.deletedIds);
    }
    renderList(state.filteredConversations, state.selectedIds);
  } catch (err) {
    if (!isAbortError(err)) {
      showStatus(`Error: ${err.message}`, 'error');
    }
  } finally {
    state.isDeleting = false;
    state.deleteAbortController = null;
    updateViewState();
  }
}

function cancelDelete() {
  if (!state.isDeleting) return;

  state.deleteAbortController?.abort();
  showStatus('Canceling delete...', 'info', { autoHide: false });
  updateViewState();
}

function getDeleteResultMessage({ deleted, failed, canceled }) {
  if (canceled) {
    return `Canceled. Deleted ${deleted}, failed ${failed}.`;
  }

  if (failed === 0) {
    return `Successfully deleted ${pluralizeConversation(deleted)}.`;
  }

  return `Deleted ${deleted}, failed ${failed}.`;
}

function getDeleteResultType({ failed, canceled }) {
  if (canceled) return 'info';
  return failed ? 'error' : 'success';
}

function pluralizeConversation(count) {
  return `${count} conversation${count === 1 ? '' : 's'}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(err) {
  return err?.name === 'AbortError';
}

els.list.addEventListener('click', handleConversationListClick);
els.list.addEventListener('scroll', handleListScroll);
els.selectAll.addEventListener('change', handleSelectAllChange);
els.loadAllButton.addEventListener('click', loadAllConversations);
els.deleteButton.addEventListener('click', handleDeleteClick);
els.confirmYes.addEventListener('click', performDelete);
els.confirmNo.addEventListener('click', hideDeleteConfirmation);
els.searchInput.addEventListener('input', handleSearchInput);

loadConversations();
