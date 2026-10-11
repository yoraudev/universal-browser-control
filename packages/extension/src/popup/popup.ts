interface Status {
  connected: boolean;
  settings: { port: number; label: string; enabled: boolean; browserId: string };
  attached: { id: number; title?: string }[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const port = $<HTMLInputElement>("port");
const label = $<HTMLInputElement>("label");
const enabled = $<HTMLInputElement>("enabled");

function render(status: Status, fillInputs: boolean): void {
  $("dot").classList.toggle("on", status.connected);
  $("status").textContent = !status.settings.enabled
    ? "Disabled"
    : status.connected
      ? `Connected to MCP server on port ${status.settings.port}`
      : `Waiting for an MCP server on port ${status.settings.port}`;
  if (fillInputs) {
    port.value = String(status.settings.port);
    label.value = status.settings.label;
    enabled.checked = status.settings.enabled;
  }
  const list = $("tabs");
  list.replaceChildren(
    ...status.attached.map((tab) => {
      const item = document.createElement("li");
      item.textContent = tab.title || `Tab ${tab.id}`;
      return item;
    }),
  );
  if (!status.attached.length) {
    const none = document.createElement("li");
    none.className = "muted";
    none.textContent = "None";
    list.append(none);
  }
}

async function refresh(type: "status" | "connect" | "detachAll", fillInputs = false): Promise<void> {
  render(await chrome.runtime.sendMessage({ type }), fillInputs);
}

port.addEventListener("change", () => {
  const value = Number(port.value);
  if (Number.isInteger(value) && value > 0 && value < 65536) void chrome.storage.local.set({ port: value });
});
label.addEventListener("change", () => void chrome.storage.local.set({ label: label.value.trim() }));
enabled.addEventListener("change", () => void chrome.storage.local.set({ enabled: enabled.checked }));
$("detach").addEventListener("click", () => void refresh("detachAll"));

void refresh("connect", true);
setInterval(() => void refresh("status"), 1000);
