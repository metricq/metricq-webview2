let pendingBackendRequests = 0;

function updateBackendPendingSpinner() {
  const spinner = document.getElementById("backendPendingSpinner");
  if (!spinner) return;
  spinner.classList.toggle("d-none", pendingBackendRequests <= 0);
}

export async function apiFetch(path, options = {}) {
  pendingBackendRequests += 1;
  updateBackendPendingSpinner();
  try {
    const resp = await fetch(path, options);
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(body.error || `HTTP ${resp.status}`);
    }
    return body;
  } finally {
    pendingBackendRequests = Math.max(0, pendingBackendRequests - 1);
    updateBackendPendingSpinner();
  }
}
