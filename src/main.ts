import { Plugin, TFile, TFolder, Notice, setIcon } from "obsidian";

export default class ExpandableFolderBookmarksPlugin extends Plugin {
  expandedBookmarks!: Set<string>;
  expandedFolders!: Set<string>;
  boundContainers!: WeakSet<Element>;
  refreshTimer: number | null = null;

  async onload(): Promise<void> {
    this.expandedBookmarks = new Set();
    this.expandedFolders = new Set();
    this.boundContainers = new WeakSet();

    this.app.workspace.onLayoutReady(() => this.refreshBookmarkViews());
    this.registerEvent(this.app.workspace.on("layout-change", () => this.queueRefresh()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.updateActiveFiles()));
    this.registerEvent(this.app.vault.on("create", () => this.queueRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.queueRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.queueRefresh()));

    const bookmarks = this.getBookmarksPlugin();
    if (bookmarks && typeof (bookmarks as any).on === "function") {
      const ref = (bookmarks as any).on("changed", () => this.queueRefresh());
      if (ref) this.registerEvent(ref);
    }

    this.addCommand({
      id: "refresh-expandable-folder-bookmarks",
      name: "刷新可展开的文件夹收藏",
      callback: () => {
        this.refreshBookmarkViews();
        new Notice("已刷新文件夹收藏");
      },
    });
  }

  onunload(): void {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    document.querySelectorAll(".cnb-folder-children").forEach((el) => el.remove());
    document.querySelectorAll(".cnb-expand-hint").forEach((el) => {
      if (el.classList.contains("tree-item-icon")) {
        setIcon(el as HTMLElement, "lucide-folder");
        el.classList.remove("collapse-icon", "cnb-expand-hint", "is-collapsed");
        delete (el as HTMLElement).dataset.cnbIcon;
      } else {
        el.remove();
      }
    });
    document.querySelectorAll(".cnb-folder-bookmark-row").forEach((el) => {
      el.classList.remove(
        "cnb-folder-bookmark-row",
        "is-cnb-expanded",
        "nav-folder-title",
        "mod-collapsible"
      );
      el.parentElement?.classList.remove("nav-folder", "is-collapsed");
    });
  }

  getBookmarksPlugin(): any {
    return (this.app as any).internalPlugins?.getEnabledPluginById?.("bookmarks") ?? null;
  }

  queueRefresh(): void {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshBookmarkViews();
    }, 100);
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

    const observer = new MutationObserver(() => this.queueRefresh());
    observer.observe(root, { childList: true, subtree: true });
    this.register(() => observer.disconnect());
  }

  buildBookmarkMap(): Map<string, any> {
    const bookmarks = this.getBookmarksPlugin();
    const result = new Map<string, any>();
    if (!bookmarks || !Array.isArray(bookmarks.items)) return result;

    const walk = (items: any[], prefix = ""): void => {
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
    if (!item || item.type !== "folder") return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this.toggleBookmarkedFolder(key, item.path, wrapper as HTMLElement, row as HTMLElement);
  }

  decorateBookmarkView(root: HTMLElement): void {
    const bookmarkMap = this.buildBookmarkMap();
    const wrappers = Array.from(root.querySelectorAll(".tree-item[data-path]"));

    for (const wrapper of wrappers) {
      const key = wrapper.getAttribute("data-path");
      const item = bookmarkMap.get(key!);
      if (!item || item.type !== "folder") continue;

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
        hint = document.createElement("div");
        hint.className = "tree-item-icon";
        row.prepend(hint);
      }
      hint.classList.add("collapse-icon", "cnb-expand-hint");

      const expanded = this.expandedBookmarks.has(key!);
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

  toggleBookmarkedFolder(key: string, folderPath: string, wrapper: HTMLElement, row: HTMLElement): void {
    const current = wrapper.querySelector(":scope > .cnb-folder-children");
    if (this.expandedBookmarks.has(key)) {
      this.expandedBookmarks.delete(key);
      current?.remove();
      row.classList.remove("is-cnb-expanded");
      const hint = row.querySelector(":scope > .cnb-expand-hint");
      this.setCollapseState(wrapper, true);
      if (hint) this.setCollapseState(hint, true);
      return;
    }

    this.expandedBookmarks.add(key);
    row.classList.add("is-cnb-expanded");
    const hint = row.querySelector(":scope > .cnb-expand-hint");
    this.setCollapseState(wrapper, false);
    if (hint) this.setCollapseState(hint, false);
    this.renderBookmarkedFolder(wrapper, folderPath);
  }

  renderBookmarkedFolder(wrapper: HTMLElement, folderPath: string): void {
    wrapper.querySelector(":scope > .cnb-folder-children")?.remove();
    const folder = this.app.vault.getAbstractFileByPath(folderPath);

    const holder = document.createElement("div");
    holder.className = "tree-item-children nav-folder-children cnb-folder-children";
    wrapper.appendChild(holder);

    if (!(folder instanceof TFolder)) {
      const missing = document.createElement("div");
      missing.className = "cnb-empty-folder";
      missing.textContent = "文件夹不存在";
      holder.appendChild(missing);
      return;
    }

    this.renderFolderContents(holder, folder);
  }

  sortChildren(children: (TFolder | TFile)[]): (TFolder | TFile)[] {
    return [...children].sort((a, b) => {
      const folderDelta = Number(b instanceof TFolder) - Number(a instanceof TFolder);
      if (folderDelta) return folderDelta;
      return a.name.localeCompare(b.name, "zh-CN", { numeric: true, sensitivity: "base" });
    });
  }

  renderFolderContents(container: HTMLElement, folder: TFolder): void {
    const children = this.sortChildren((folder.children as (TFolder | TFile)[]) ?? []);
    if (children.length === 0) {
      const empty = document.createElement("div");
      empty.className = "cnb-empty-folder";
      empty.textContent = "空文件夹";
      container.appendChild(empty);
      return;
    }

    for (const child of children) {
      if (child instanceof TFolder) this.renderInlineFolder(container, child);
      else if (child instanceof TFile) this.renderInlineFile(container, child);
    }
  }

  renderInlineFolder(container: HTMLElement, folder: TFolder): void {
    const wrapper = document.createElement("div");
    wrapper.className = "tree-item nav-folder cnb-tree-item";
    wrapper.dataset.folderPath = folder.path;

    const row = document.createElement("div");
    row.className = "tree-item-self nav-folder-title is-clickable mod-collapsible cnb-inline-folder-row";
    wrapper.appendChild(row);

    const collapse = document.createElement("div");
    collapse.className = "tree-item-icon collapse-icon";
    setIcon(collapse, "right-triangle");
    row.appendChild(collapse);

    const title = document.createElement("div");
    title.className = "tree-item-inner nav-folder-title-content";
    title.textContent = folder.name;
    row.appendChild(title);

    const nested = document.createElement("div");
    nested.className = "tree-item-children nav-folder-children cnb-inline-children";
    wrapper.appendChild(nested);

    row.addEventListener("click", (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.expandedFolders.has(folder.path)) {
        this.expandedFolders.delete(folder.path);
        nested.empty();
        nested.hidden = true;
        this.setCollapseState(wrapper, true);
        this.setCollapseState(collapse, true);
      } else {
        this.expandedFolders.add(folder.path);
        nested.hidden = false;
        this.renderFolderContents(nested, folder);
        this.setCollapseState(wrapper, false);
        this.setCollapseState(collapse, false);
      }
    });

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
    const wrapper = document.createElement("div");
    wrapper.className = "tree-item nav-file cnb-tree-item";

    const row = document.createElement("div");
    row.className = "tree-item-self nav-file-title is-clickable cnb-inline-file-row";
    row.dataset.filePath = file.path;
    wrapper.appendChild(row);

    const title = document.createElement("div");
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

    container.appendChild(wrapper);
  }

  updateActiveFiles(): void {
    const activePath = this.app.workspace.getActiveFile()?.path ?? "";
    document.querySelectorAll(".cnb-inline-file-row").forEach((row) => {
      row.classList.toggle("is-active", (row as HTMLElement).dataset.filePath === activePath);
    });
  }
}
