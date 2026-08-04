import { EventRef, Menu, Plugin, TFile, TFolder, Notice, setIcon } from "obsidian";

interface BookmarkFolderExpandState {
  expandedBookmarks?: string[];
  expandedFolders?: string[];
}

interface BookmarkItemLike {
  type: string;
  ctime?: number;
  path?: string;
  title?: string;
  items?: BookmarkItemLike[];
}

interface BookmarksPluginLike {
  items: BookmarkItemLike[];
  bookmarkLookup?: Record<string, BookmarkItemLike>;
  getItemTitle(item: BookmarkItemLike): string;
  on?(name: "changed", callback: () => void): EventRef;
}

interface BookmarkItemDomLike {
  selfEl: HTMLElement;
  titleEl: HTMLElement;
  onContextMenu(event: MouseEvent): void;
}

interface BookmarksViewLike {
  containerEl: HTMLElement;
  getItemDom(item: BookmarkItemLike): BookmarkItemDomLike;
}

interface FileExplorerViewLike {
  getSortedFolderItems?(folder: TFolder): Array<{ file?: unknown }>;
  attachDropHandler?(folder: TFolder, row: HTMLElement): void;
  revealInFolder?(file: TFolder | TFile): void;
}

interface DragManagerLike {
  handleDrag?(row: HTMLElement, callback: (event: DragEvent) => unknown): void;
  updateSource?(rows: HTMLElement[], className: string): void;
  dragFile?(event: DragEvent, file: TFile): unknown;
  dragFolder?(event: DragEvent, folder: TFolder): unknown;
}

interface AppInternalsLike {
  internalPlugins?: {
    getEnabledPluginById?(id: string): unknown;
  };
  dragManager?: DragManagerLike;
}

export default class ExpandableFolderBookmarksPlugin extends Plugin {
  expandedBookmarks!: Set<string>;
  expandedFolders!: Set<string>;
  boundContainers!: WeakSet<Element>;
  refreshTimer: number | null = null;
  contentRefreshTimer: number | null = null;
  pendingContentPaths!: Set<string>;
  suppressBookmarkObserver = false;
  observerReleaseTimer: number | null = null;
  stateSaveTimer: number | null = null;

  async onload(): Promise<void> {
    const saved = (await this.loadData()) as BookmarkFolderExpandState | null;
    this.expandedBookmarks = new Set(saved?.expandedBookmarks ?? []);
    this.expandedFolders = new Set(saved?.expandedFolders ?? []);
    this.boundContainers = new WeakSet();
    this.pendingContentPaths = new Set();

    this.app.workspace.onLayoutReady(() => {
      this.refreshBookmarkViews();
      this.registerEvent(this.app.vault.on("create", (file) => this.queueContentRefresh(file.path)));
      this.registerEvent(this.app.vault.on("delete", (file) => this.queueContentRefresh(file.path)));
      this.registerEvent(
        this.app.vault.on("rename", (file, oldPath) => {
          if (file instanceof TFolder) this.migrateExpandedFolderPaths(oldPath, file.path);
          this.queueContentRefresh(file.path, oldPath);
        })
      );
    });
    this.registerEvent(this.app.workspace.on("layout-change", () => this.queueRefresh()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.updateActiveFiles()));

    const bookmarks = this.getBookmarksPlugin();
    if (bookmarks?.on) {
      const ref = bookmarks.on("changed", () => {
        this.queueRefresh();
        this.queueContentRefresh();
      });
      if (ref) this.registerEvent(ref);
    }

    this.addCommand({
      id: "refresh-expandable-folder-bookmarks",
      name: "刷新可展开的文件夹收藏",
      callback: () => {
        this.refreshBookmarkViews();
        this.refreshExpandedContents();
        new Notice("已刷新文件夹收藏");
      },
    });
  }

  onunload(): void {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    if (this.contentRefreshTimer) window.clearTimeout(this.contentRefreshTimer);
    if (this.observerReleaseTimer) window.clearTimeout(this.observerReleaseTimer);
    if (this.stateSaveTimer) {
      window.clearTimeout(this.stateSaveTimer);
      void this.saveExpansionState();
    }
    for (const leaf of this.app.workspace.getLeavesOfType("bookmarks")) {
      const root = leaf.view?.containerEl;
      if (root) this.cleanupBookmarkView(root);
    }
  }

  getBookmarksPlugin(): BookmarksPluginLike | null {
    const app = this.app as typeof this.app & AppInternalsLike;
    return (app.internalPlugins?.getEnabledPluginById?.("bookmarks") as BookmarksPluginLike) ?? null;
  }

  getBookmarksView(target?: Element): BookmarksViewLike | null {
    const leaves = this.app.workspace.getLeavesOfType("bookmarks");
    if (target) {
      const matching = leaves.find((leaf) => leaf.view?.containerEl?.contains(target));
      if (matching) return matching.view as unknown as BookmarksViewLike;
    }
    return (leaves[0]?.view as unknown as BookmarksViewLike) ?? null;
  }

  cleanupBookmarkView(root: HTMLElement): void {
    root.querySelectorAll(".cnb-folder-children").forEach((el) => el.remove());
    root.querySelectorAll(".cnb-expand-hint").forEach((el) => {
      if (el.classList.contains("tree-item-icon")) {
        setIcon(el as HTMLElement, "lucide-folder");
        el.classList.remove("collapse-icon", "cnb-expand-hint", "is-collapsed");
        delete (el as HTMLElement).dataset.cnbIcon;
      } else {
        el.remove();
      }
    });
    root.querySelectorAll(".cnb-folder-bookmark-row").forEach((el) => {
      el.classList.remove(
        "cnb-folder-bookmark-row",
        "is-cnb-expanded",
        "nav-folder-title",
        "mod-collapsible"
      );
      el.parentElement?.classList.remove("nav-folder", "is-collapsed");
    });
  }

  getBookmarkStateId(item: BookmarkItemLike): string {
    return String(item?.ctime ?? `${item?.type ?? "folder"}:${item?.path ?? ""}`);
  }

  queueSaveExpansionState(): void {
    if (this.stateSaveTimer) window.clearTimeout(this.stateSaveTimer);
    this.stateSaveTimer = window.setTimeout(() => {
      this.stateSaveTimer = null;
      void this.saveExpansionState();
    }, 100);
  }

  async saveExpansionState(): Promise<void> {
    await this.saveData({
      expandedBookmarks: Array.from(this.expandedBookmarks),
      expandedFolders: Array.from(this.expandedFolders),
    } satisfies BookmarkFolderExpandState);
  }

  migrateExpandedFolderPaths(oldPath: string, newPath: string): void {
    let changed = false;
    const migrated = new Set<string>();
    for (const path of this.expandedFolders) {
      if (path === oldPath || path.startsWith(`${oldPath}/`)) {
        migrated.add(`${newPath}${path.slice(oldPath.length)}`);
        changed = true;
      } else {
        migrated.add(path);
      }
    }
    if (!changed) return;
    this.expandedFolders = migrated;
    this.queueSaveExpansionState();
  }

  getFileExplorerView(): FileExplorerViewLike | null {
    return (this.app.workspace.getLeavesOfType("file-explorer")[0]?.view as unknown as FileExplorerViewLike) ?? null;
  }

  markInternalMutation(): void {
    this.suppressBookmarkObserver = true;
    if (this.observerReleaseTimer) window.clearTimeout(this.observerReleaseTimer);
    this.observerReleaseTimer = window.setTimeout(() => {
      this.suppressBookmarkObserver = false;
      this.observerReleaseTimer = null;
    }, 0);
  }

  queueRefresh(): void {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshBookmarkViews();
    }, 100);
  }

  queueContentRefresh(...paths: string[]): void {
    for (const path of paths) {
      if (path) this.pendingContentPaths.add(path);
    }
    if (this.contentRefreshTimer) window.clearTimeout(this.contentRefreshTimer);
    this.contentRefreshTimer = window.setTimeout(() => {
      this.contentRefreshTimer = null;
      const changedPaths = this.pendingContentPaths.size > 0
        ? new Set(this.pendingContentPaths)
        : undefined;
      this.pendingContentPaths.clear();
      this.refreshExpandedContents(changedPaths);
    }, 120);
  }

  refreshBookmarkViews(): void {
    const bookmarks = this.getBookmarksPlugin();
    if (!bookmarks) return;

    for (const leaf of this.app.workspace.getLeavesOfType("bookmarks")) {
      const root = leaf.view?.containerEl;
      if (!root) continue;
      this.bindBookmarkView(root);
      this.decorateBookmarkView(root);
    }
  }

  bindBookmarkView(root: HTMLElement): void {
    if (this.boundContainers.has(root)) return;
    this.boundContainers.add(root);

    this.registerDomEvent(
      root,
      "click",
      (event: MouseEvent) => this.handleBookmarkClick(event, root),
      { capture: true }
    );

    const observer = new MutationObserver(() => {
      if (!this.suppressBookmarkObserver) this.queueRefresh();
    });
    observer.observe(root, { childList: true, subtree: true });
    this.register(() => observer.disconnect());
  }

  buildBookmarkMap(): Map<string, BookmarkItemLike> {
    const bookmarks = this.getBookmarksPlugin();
    const result = new Map<string, BookmarkItemLike>();
    if (!bookmarks || !Array.isArray(bookmarks.items)) return result;

    const walk = (items: BookmarkItemLike[], prefix = ""): void => {
      for (const item of items) {
        const title = bookmarks.getItemTitle(item);
        const key = prefix ? `${prefix}/${title}` : title;
        result.set(key, item);
        if (item.type === "group" && Array.isArray(item.items)) walk(item.items, key);
      }
    };

    walk(bookmarks.items);
    return result;
  }

  getBookmarkWrapper(row: Element): Element | null {
    const wrapper = row.parentElement;
    return wrapper?.classList.contains("tree-item") ? wrapper : row.closest(".tree-item[data-path]");
  }

  setTrackedIcon(element: HTMLElement, iconName: string): void {
    if (element.dataset.cnbIcon === iconName) return;
    setIcon(element, iconName);
    element.dataset.cnbIcon = iconName;
  }

  setCollapseState(element: Element, collapsed: boolean): void {
    element.classList.toggle("is-collapsed", collapsed);
  }

  handleBookmarkClick(event: MouseEvent, root: HTMLElement): void {
    if (event.button !== 0) return;
    const row = (event.target as Element).closest(".tree-item-self.bookmark");
    if (!row || !root.contains(row)) return;

    const wrapper = this.getBookmarkWrapper(row);
    const key = wrapper?.getAttribute("data-path");
    if (!wrapper || !key) return;

    const item = this.buildBookmarkMap().get(key);
    if (!item || item.type !== "folder" || typeof item.path !== "string") return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this.toggleBookmarkedFolder(
      this.getBookmarkStateId(item),
      item.path,
      wrapper as HTMLElement,
      row as HTMLElement
    );
  }

  decorateBookmarkView(root: HTMLElement): void {
    this.markInternalMutation();
    const bookmarkMap = this.buildBookmarkMap();
    const wrappers = Array.from(root.querySelectorAll(".tree-item[data-path]"));

    for (const wrapper of wrappers) {
      const key = wrapper.getAttribute("data-path");
      const item = bookmarkMap.get(key!);
      if (!item || item.type !== "folder" || typeof item.path !== "string") continue;

      const row = Array.from(wrapper.children)
        .find((child) =>
          child instanceof HTMLElement &&
          child.classList.contains("tree-item-self") &&
          child.classList.contains("bookmark")
        ) as HTMLElement | undefined;
      if (!row) continue;

      wrapper.classList.add("nav-folder");
      row.classList.add(
        "cnb-folder-bookmark-row",
        "nav-folder-title",
        "mod-collapsible"
      );

      let hint: Element | null = row.querySelector(":scope > .cnb-expand-hint");
      if (!hint || !hint.classList.contains("tree-item-icon")) {
        const originalIcon = row.querySelector(":scope > .tree-item-icon:not(.cnb-expand-hint)");
        hint?.remove();
        hint = originalIcon;
      }
      if (!hint) {
        hint = root.ownerDocument.createElement("div");
        hint.className = "tree-item-icon";
        row.prepend(hint);
      }
      hint.classList.add("collapse-icon", "cnb-expand-hint");

      const bookmarkId = this.getBookmarkStateId(item);
      const expanded = this.expandedBookmarks.has(bookmarkId);
      row.classList.toggle("is-cnb-expanded", expanded);
      this.setTrackedIcon(hint as HTMLElement, "right-triangle");
      this.setCollapseState(wrapper, !expanded);
      this.setCollapseState(hint, !expanded);

      if (expanded && !wrapper.querySelector(":scope > .cnb-folder-children")) {
        this.renderBookmarkedFolder(wrapper as HTMLElement, item.path);
      }
    }

    this.updateActiveFiles();
  }

  refreshExpandedContents(changedPaths?: Set<string>): void {
    if (this.expandedBookmarks.size === 0) return;

    const bookmarkMap = this.buildBookmarkMap();
    const changed = changedPaths ? Array.from(changedPaths) : null;
    this.markInternalMutation();
    for (const leaf of this.app.workspace.getLeavesOfType("bookmarks")) {
      const root = leaf.view?.containerEl;
      if (!root) continue;

      for (const wrapper of Array.from(root.querySelectorAll<HTMLElement>(".tree-item[data-path]"))) {
        const key = wrapper.dataset.path;
        if (!key) continue;
        const item = bookmarkMap.get(key);
        if (item?.type !== "folder") continue;
        if (!this.expandedBookmarks.has(this.getBookmarkStateId(item))) continue;

        const folderPath = item.path as string;
        const affected = !changed || folderPath === "" || changed.some((path) =>
          path === folderPath || path.startsWith(`${folderPath}/`) || folderPath.startsWith(`${path}/`)
        );
        if (affected) this.renderBookmarkedFolder(wrapper, folderPath);
      }
    }
    this.updateActiveFiles();
  }

  toggleBookmarkedFolder(bookmarkId: string, folderPath: string, wrapper: HTMLElement, row: HTMLElement): void {
    this.markInternalMutation();
    const current = wrapper.querySelector(":scope > .cnb-folder-children");
    if (this.expandedBookmarks.has(bookmarkId)) {
      this.expandedBookmarks.delete(bookmarkId);
      this.queueSaveExpansionState();
      current?.remove();
      row.classList.remove("is-cnb-expanded");
      const hint = row.querySelector(":scope > .cnb-expand-hint");
      this.setCollapseState(wrapper, true);
      if (hint) this.setCollapseState(hint, true);
      return;
    }

    this.expandedBookmarks.add(bookmarkId);
    this.queueSaveExpansionState();
    row.classList.add("is-cnb-expanded");
    const hint = row.querySelector(":scope > .cnb-expand-hint");
    this.setCollapseState(wrapper, false);
    if (hint) this.setCollapseState(hint, false);
    this.renderBookmarkedFolder(wrapper, folderPath);
  }

  renderBookmarkedFolder(wrapper: HTMLElement, folderPath: string): void {
    this.markInternalMutation();
    wrapper.querySelector(":scope > .cnb-folder-children")?.remove();
    const folder = this.app.vault.getAbstractFileByPath(folderPath);

    const holder = wrapper.ownerDocument.createElement("div");
    holder.className = "tree-item-children nav-folder-children cnb-folder-children";
    wrapper.appendChild(holder);

    if (!(folder instanceof TFolder)) {
      const missing = wrapper.ownerDocument.createElement("div");
      missing.className = "cnb-empty-folder";
      missing.textContent = "文件夹不存在";
      holder.appendChild(missing);
      return;
    }

    this.renderFolderContents(holder, folder);
  }

  getSortedChildren(folder: TFolder): (TFolder | TFile)[] {
    const explorerView = this.getFileExplorerView();

    if (typeof explorerView?.getSortedFolderItems === "function") {
      try {
        const sortedItems = explorerView.getSortedFolderItems(folder) as Array<{ file?: unknown }>;
        const sortedFiles = sortedItems
          .map((item) => item?.file)
          .filter((file): file is TFolder | TFile => file instanceof TFolder || file instanceof TFile);

        if (sortedFiles.length === folder.children.length) return sortedFiles;
      } catch (error) {
        console.warn("[Bookmark Folder Expand] Unable to reuse File Explorer sorting", error);
      }
    }

    return [...(folder.children as (TFolder | TFile)[])].sort((a, b) => {
      const folderDelta = Number(b instanceof TFolder) - Number(a instanceof TFolder);
      if (folderDelta) return folderDelta;
      return a.name.localeCompare(b.name, "zh-CN", { numeric: true, sensitivity: "base" });
    });
  }

  renderFolderContents(container: HTMLElement, folder: TFolder): void {
    const children = this.getSortedChildren(folder);
    if (children.length === 0) return;

    for (const child of children) {
      if (child instanceof TFolder) this.renderInlineFolder(container, child);
      else if (child instanceof TFile) this.renderInlineFile(container, child);
    }
  }

  renderInlineFolder(container: HTMLElement, folder: TFolder): void {
    const doc = container.ownerDocument;
    const wrapper = doc.createElement("div");
    wrapper.className = "tree-item nav-folder cnb-tree-item";
    wrapper.dataset.folderPath = folder.path;

    const row = doc.createElement("div");
    row.className = "tree-item-self nav-folder-title is-clickable mod-collapsible cnb-inline-folder-row";
    wrapper.appendChild(row);

    const collapse = doc.createElement("div");
    collapse.className = "tree-item-icon collapse-icon";
    setIcon(collapse, "right-triangle");
    row.appendChild(collapse);

    const title = doc.createElement("div");
    title.className = "tree-item-inner nav-folder-title-content";
    title.textContent = folder.name;
    row.appendChild(title);

    const nested = doc.createElement("div");
    nested.className = "tree-item-children nav-folder-children cnb-inline-children";
    wrapper.appendChild(nested);

    row.addEventListener("click", (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.expandedFolders.has(folder.path)) {
        this.expandedFolders.delete(folder.path);
        this.queueSaveExpansionState();
        nested.empty();
        nested.hidden = true;
        this.setCollapseState(wrapper, true);
        this.setCollapseState(collapse, true);
      } else {
        this.expandedFolders.add(folder.path);
        this.queueSaveExpansionState();
        nested.hidden = false;
        this.renderFolderContents(nested, folder);
        this.updateActiveFiles();
        this.setCollapseState(wrapper, false);
        this.setCollapseState(collapse, false);
      }
    });
    row.addEventListener("contextmenu", (event: MouseEvent) => {
      this.showBookmarkMenu(event, folder, row, title);
    });
    this.enableNativeDrag(row, folder);
    this.enableNativeDrop(row, folder);

    if (this.expandedFolders.has(folder.path)) {
      this.setCollapseState(wrapper, false);
      this.setCollapseState(collapse, false);
      this.renderFolderContents(nested, folder);
    } else {
      this.setCollapseState(wrapper, true);
      this.setCollapseState(collapse, true);
      nested.hidden = true;
    }

    container.appendChild(wrapper);
  }

  renderInlineFile(container: HTMLElement, file: TFile): void {
    const doc = container.ownerDocument;
    const wrapper = doc.createElement("div");
    wrapper.className = "tree-item nav-file cnb-tree-item";

    const row = doc.createElement("div");
    row.className = "tree-item-self nav-file-title is-clickable cnb-inline-file-row";
    row.dataset.filePath = file.path;
    row.classList.toggle("is-active", this.app.workspace.getActiveFile()?.path === file.path);
    wrapper.appendChild(row);

    const title = doc.createElement("div");
    title.className = "tree-item-inner nav-file-title-content";
    title.textContent = file.basename;
    row.appendChild(title);

    const open = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const newLeaf = event.ctrlKey || event.metaKey || event.button === 1;
      this.app.workspace.openLinkText(file.path, "", newLeaf);
    };

    row.addEventListener("click", open);
    row.addEventListener("auxclick", (event: MouseEvent) => {
      if (event.button === 1) open(event);
    });
    row.addEventListener("contextmenu", (event: MouseEvent) => {
      this.showBookmarkMenu(event, file, row, title);
    });
    row.addEventListener("mouseover", (event: MouseEvent) => {
      this.app.workspace.trigger("hover-link", {
        event,
        source: "bookmarks",
        hoverParent: this,
        targetEl: row,
        linktext: file.path,
      });
    });
    this.enableNativeDrag(row, file);

    container.appendChild(wrapper);
  }

  enableNativeDrag(row: HTMLElement, file: TFolder | TFile): void {
    const app = this.app as typeof this.app & AppInternalsLike;
    const dragManager = app.dragManager;
    if (typeof dragManager?.handleDrag !== "function") return;

    dragManager.handleDrag(row, (event: DragEvent) => {
      dragManager.updateSource?.([row], "is-being-dragged");

      if (file instanceof TFile && typeof dragManager.dragFile === "function") {
        return dragManager.dragFile(event, file);
      }
      if (file instanceof TFolder && typeof dragManager.dragFolder === "function") {
        return dragManager.dragFolder(event, file);
      }
      return null;
    });
  }

  enableNativeDrop(row: HTMLElement, folder: TFolder): void {
    const explorerView = this.getFileExplorerView();
    if (typeof explorerView?.attachDropHandler !== "function") return;

    try {
      explorerView.attachDropHandler(folder, row);
    } catch (error) {
      console.warn("[Bookmark Folder Expand] Unable to reuse File Explorer drop handling", error);
    }
  }

  showBookmarkMenu(
    event: MouseEvent,
    file: TFolder | TFile,
    row: HTMLElement,
    title: HTMLElement
  ): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const bookmarks = this.getBookmarksPlugin();
    const bookmarksView = this.getBookmarksView(row);
    if (bookmarks && typeof bookmarksView?.getItemDom === "function") {
      try {
        const existingItem = bookmarks.bookmarkLookup?.[file.path];
        const bookmarkItem = existingItem ?? {
          type: file instanceof TFolder ? "folder" : "file",
          ctime: Date.now(),
          path: file.path,
        };
        const itemDom = bookmarksView.getItemDom(bookmarkItem);
        if (itemDom && typeof itemDom.onContextMenu === "function") {
          if (!existingItem) {
            itemDom.selfEl = row;
            itemDom.titleEl = title;
          }
          itemDom.onContextMenu(event);
          return;
        }
      } catch (error) {
        console.warn("[Bookmark Folder Expand] Unable to reuse Bookmarks context menu", error);
      }
    }

    this.showFallbackBookmarkMenu(event, file);
  }

  showFallbackBookmarkMenu(event: MouseEvent, file: TFolder | TFile): void {
    const menu = new Menu();
    const bookmarkItem = {
      type: file instanceof TFolder ? "folder" : "file",
      ctime: Date.now(),
      path: file.path,
    };
    this.app.workspace.trigger("bookmarks:bookmarks-menu", menu, [bookmarkItem]);
    menu.addItem((item) =>
      item
        .setSection("view")
        .setTitle("在文件列表中显示")
        .setIcon("folder-open")
        .onClick(() => this.getFileExplorerView()?.revealInFolder?.(file))
    );

    menu.showAtMouseEvent(event);
  }

  updateActiveFiles(): void {
    const activePath = this.app.workspace.getActiveFile()?.path ?? "";
    for (const leaf of this.app.workspace.getLeavesOfType("bookmarks")) {
      leaf.view?.containerEl?.querySelectorAll(".cnb-inline-file-row").forEach((row) => {
        row.classList.toggle("is-active", (row as HTMLElement).dataset.filePath === activePath);
      });
    }
  }
}
