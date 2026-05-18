export const els = {
  list: document.getElementById('conversation-list'),
  selectAll: document.getElementById('select-all'),
  loadAllButton: document.getElementById('btn-load-all'),
  deleteButton: document.getElementById('btn-delete'),
  searchInput: document.getElementById('search-input'),
  statusBar: document.getElementById('status-bar'),
  confirmModal: document.getElementById('confirm-modal'),
  confirmMessage: document.getElementById('confirm-message'),
  confirmYes: document.getElementById('btn-confirm-yes'),
  confirmNo: document.getElementById('btn-confirm-no'),
  totalInfo: document.getElementById('total-info'),
};

const STATUS_AUTO_HIDE_MS = 3500;
let statusTimer = null;

export function getSearchQuery() {
  return els.searchInput.value.toLowerCase().trim();
}

export function showStatus(message, type = 'info', { autoHide = true } = {}) {
  clearStatusTimer();
  els.statusBar.textContent = message;
  els.statusBar.className = `status-bar ${type}`;
  els.statusBar.classList.remove('hidden');

  if (autoHide) {
    statusTimer = setTimeout(hideStatus, STATUS_AUTO_HIDE_MS);
  }
}

export function hideStatus() {
  clearStatusTimer();
  els.statusBar.classList.add('hidden');
}

function clearStatusTimer() {
  if (!statusTimer) return;

  clearTimeout(statusTimer);
  statusTimer = null;
}

export function setLoadingMessage(message) {
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = message;
  els.list.replaceChildren(loading);
}

export function renderList(conversations, selectedIds) {
  if (conversations.length === 0) {
    setLoadingMessage('No conversations found.');
    return;
  }

  els.list.replaceChildren();
  appendConversationItems(conversations, selectedIds);
}

export function appendConversationItems(conversations, selectedIds) {
  const loading = els.list.querySelector('.loading');
  if (loading) {
    loading.remove();
  }

  const fragment = document.createDocumentFragment();
  conversations.forEach((conversation) => {
    fragment.append(createConversationItem(conversation, selectedIds));
  });

  els.list.append(fragment);
}

export function updateToolbar({
  conversations,
  selectedIds,
  hasMore,
  isLoading,
  isLoadingAll,
  isDeleting,
}) {
  const visibleIds = conversations.map((conversation) => conversation.id);
  const selectedVisibleIds = visibleIds.filter((id) => selectedIds.has(id));
  const allVisibleSelected =
    visibleIds.length > 0 && selectedVisibleIds.length === visibleIds.length;

  els.loadAllButton.disabled = !hasMore || isLoading || isLoadingAll || isDeleting;
  els.loadAllButton.textContent = isLoadingAll ? 'Loading...' : 'Load All';

  els.deleteButton.disabled = selectedIds.size === 0 && !isDeleting;
  els.deleteButton.textContent = isDeleting
    ? 'Cancel Delete'
    : selectedIds.size
      ? `Delete Selected (${selectedIds.size})`
      : 'Delete Selected';
  els.deleteButton.classList.toggle('btn-delete-cancel', isDeleting);

  els.selectAll.disabled = isDeleting;
  els.selectAll.checked = allVisibleSelected;
  els.selectAll.indeterminate = !allVisibleSelected && selectedVisibleIds.length > 0;
}

export function updateTotalInfo({ visibleCount, loadedCount, hasMore, hasQuery }) {
  if (hasMore) {
    els.totalInfo.textContent = hasQuery
      ? `${visibleCount} matching loaded`
      : `${loadedCount} loaded`;
    return;
  }

  els.totalInfo.textContent = hasQuery
    ? `${visibleCount} match${visibleCount === 1 ? '' : 'es'}`
    : `${loadedCount} conversation${loadedCount === 1 ? '' : 's'}`;
}

export function showDeleteConfirmation(count) {
  const label = `${count} conversation${count === 1 ? '' : 's'}`;
  els.confirmMessage.textContent =
    `Are you sure you want to delete ${label}? This cannot be undone.`;
  els.confirmModal.classList.remove('hidden');
}

export function hideDeleteConfirmation() {
  els.confirmModal.classList.add('hidden');
}

function createConversationItem(conversation, selectedIds) {
  const item = document.createElement('div');
  item.className = 'conversation-item';
  item.dataset.id = conversation.id;
  item.title = 'Open conversation';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = selectedIds.has(conversation.id);

  const title = document.createElement('span');
  title.className = 'conv-title';
  title.title = getConversationTitle(conversation);
  title.textContent = getConversationTitle(conversation);

  const date = document.createElement('span');
  date.className = 'conv-date';
  date.textContent = formatDate(conversation.update_time || conversation.create_time);

  item.append(checkbox, title, date);
  return item;
}

function getConversationTitle(conversation) {
  return conversation.title || 'Untitled';
}

function formatDate(isoString) {
  if (!isoString) return '';

  return new Date(isoString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
