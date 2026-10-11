import { evaluate, page, type Handler } from "./common";

function bookmarkInfo(node: chrome.bookmarks.BookmarkTreeNode): object {
  return { id: node.id, title: node.title, url: node.url, parent_id: node.parentId, children: node.children?.map(bookmarkInfo) };
}

export const dataHandlers: Record<string, Handler> = {
  async cookies(p) {
    if (p.action === "get") {
      const cookies = await chrome.cookies.getAll({ url: p.url, domain: p.domain, name: p.name });
      return cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        http_only: c.httpOnly,
        same_site: c.sameSite,
        expires: c.expirationDate,
      }));
    }
    if (!p.url || !p.name) throw new Error(`cookies ${p.action} needs url and name.`);
    if (p.action === "delete") {
      const removed = await chrome.cookies.remove({ url: p.url, name: p.name });
      return { deleted: !!removed };
    }
    const cookie = await chrome.cookies.set({
      url: p.url,
      name: p.name,
      value: p.value ?? "",
      domain: p.domain,
      path: p.path,
      secure: p.secure,
      httpOnly: p.http_only,
      sameSite: p.same_site,
      expirationDate: p.expires,
    });
    if (!cookie) throw new Error("The browser rejected the cookie.");
    return { set: cookie.name, domain: cookie.domain };
  },

  async storage(p) {
    const state = await page(p);
    const area = p.area === "session" ? "sessionStorage" : "localStorage";
    const key = JSON.stringify(p.key ?? null);
    if (p.action === "get") {
      return evaluate(state, p.key === undefined ? `Object.fromEntries(Object.entries(${area}))` : `${area}.getItem(${key})`);
    }
    if (p.action !== "clear" && p.key === undefined) throw new Error(`storage ${p.action} needs key.`);
    if (p.action === "set") await evaluate(state, `${area}.setItem(${key}, ${JSON.stringify(p.value ?? "")})`);
    else if (p.action === "remove") await evaluate(state, `${area}.removeItem(${key})`);
    else await evaluate(state, `${area}.clear()`);
    return { ok: true, items: await evaluate<number>(state, `${area}.length`) };
  },

  async downloads(p) {
    if (p.action === "start") {
      if (!p.url) throw new Error("downloads start needs url.");
      return { download_id: await chrome.downloads.download({ url: p.url, filename: p.filename }) };
    }
    if (p.action === "cancel") {
      if (p.download_id === undefined) throw new Error("downloads cancel needs download_id.");
      await chrome.downloads.cancel(p.download_id);
      return { canceled: p.download_id };
    }
    const items = await chrome.downloads.search({ query: p.query ? [p.query] : undefined, limit: p.limit, orderBy: ["-startTime"] });
    return items.map((d) => ({
      id: d.id,
      url: d.url,
      filename: d.filename,
      state: d.state,
      bytes_received: d.bytesReceived,
      total_bytes: d.totalBytes,
      mime: d.mime,
      start_time: d.startTime,
      error: d.error,
    }));
  },

  async history_search(p) {
    const items = await chrome.history.search({ text: p.query, startTime: Date.now() - p.days * 86_400_000, maxResults: p.limit });
    return items.map((item) => ({
      url: item.url,
      title: item.title,
      visit_count: item.visitCount,
      last_visit: item.lastVisitTime ? new Date(item.lastVisitTime).toISOString() : undefined,
    }));
  },

  async bookmarks(p) {
    if (p.action === "tree") return (await chrome.bookmarks.getTree()).map(bookmarkInfo);
    if (p.action === "search") return (await chrome.bookmarks.search(p.query ?? "")).map(bookmarkInfo);
    if (p.action === "create") {
      if (!p.title) throw new Error("bookmarks create needs title (and url, unless creating a folder).");
      return bookmarkInfo(await chrome.bookmarks.create({ parentId: p.parent_id, title: p.title, url: p.url }));
    }
    if (!p.id) throw new Error("bookmarks remove needs id.");
    await chrome.bookmarks.remove(p.id);
    return { removed: p.id };
  },
};
