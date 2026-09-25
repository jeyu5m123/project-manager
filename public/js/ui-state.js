const TASK_VIEW_KEY = 'pm-task-view';
const TASK_FILTERS = new Set(['all', 'todo', 'inprogress', 'done']);
const TASK_SORTS = new Set(['due-asc', 'due-desc', 'priority', 'created', 'name']);
const DEFAULT_TASK_VIEW = Object.freeze({ filter: 'all', sort: 'due-asc' });

function normalizeTaskViewPreferences(value) {
  const preferences = value && typeof value === 'object' ? value : {};
  return {
    filter: TASK_FILTERS.has(preferences.filter) ? preferences.filter : DEFAULT_TASK_VIEW.filter,
    sort: TASK_SORTS.has(preferences.sort) ? preferences.sort : DEFAULT_TASK_VIEW.sort,
  };
}

function readTaskViewPreferences(storage) {
  if (!storage || typeof storage.getItem !== 'function') return { ...DEFAULT_TASK_VIEW };

  try {
    const raw = storage.getItem(TASK_VIEW_KEY);
    return normalizeTaskViewPreferences(raw ? JSON.parse(raw) : null);
  } catch (_error) {
    return { ...DEFAULT_TASK_VIEW };
  }
}

function writeTaskViewPreferences(storage, value) {
  const normalized = normalizeTaskViewPreferences(value);
  if (storage && typeof storage.setItem === 'function') {
    try {
      storage.setItem(TASK_VIEW_KEY, JSON.stringify(normalized));
    } catch (_error) {
      // Private browsing or a full storage quota should not block task updates.
    }
  }
  return normalized;
}

function matchesCommandQuery(item, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return true;
  const label = String(item?.label || '').toLowerCase();
  const metadata = String(item?.metadata || '').toLowerCase();
  return `${label} ${metadata}`.includes(normalizedQuery);
}

const UiState = {
  normalizeTaskViewPreferences,
  readTaskViewPreferences,
  writeTaskViewPreferences,
  matchesCommandQuery,
};

if (typeof window !== 'undefined') window.UiState = UiState;

export {
  DEFAULT_TASK_VIEW,
  normalizeTaskViewPreferences,
  readTaskViewPreferences,
  writeTaskViewPreferences,
  matchesCommandQuery,
};
