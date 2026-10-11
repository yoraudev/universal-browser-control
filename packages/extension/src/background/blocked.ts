const STORAGE_KEY = "blockedTabs";
const blocked = new Set<number>();

const loaded = chrome.storage.session.get(STORAGE_KEY).then((stored) => {
  for (const tabId of (stored[STORAGE_KEY] as number[] | undefined) ?? []) blocked.add(tabId);
});

const save = () => chrome.storage.session.set({ [STORAGE_KEY]: [...blocked] });

export async function blockedTabs(): Promise<number[]> {
  await loaded;
  return [...blocked];
}

export async function assertNotBlocked(tabId: number): Promise<void> {
  await loaded;
  if (!blocked.has(tabId)) return;
  throw new Error(
    `The user stopped control of tab ${tabId}. Leave this tab alone and tell the user; they can allow control again from the extension popup.`,
  );
}

export async function blockTab(tabId: number): Promise<void> {
  await loaded;
  blocked.add(tabId);
  await save();
}

export async function unblockAll(): Promise<void> {
  await loaded;
  blocked.clear();
  await save();
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await loaded;
  if (blocked.delete(tabId)) await save();
});
