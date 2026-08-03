# Expandable Folder Bookmarks 交接

## 地址

- 正式安装目录：`D:\Obsidian--hub\Codex-Notes\.obsidian\plugins\expandable-folder-bookmarks`
- 开发/暂存目录：`F:\000_桌面\expandable-folder-bookmarks-stage`
- 当前版本：`0.1.3`

## 功能

- 在 Obsidian“书签”侧栏内直接展开收藏的文件夹，不跳回文件目录。
- 支持递归展开子文件夹。
- 点击文件直接打开；Ctrl/Meta 单击或鼠标中键可在新标签打开。
- `First` 是用户仓库，禁止修改；只允许修改 `Codex-Notes`。

## 当前实现原则

- 插件只提供行为，不独立设计外观。
- 根收藏项复用原有左侧图标位置，改为 Obsidian 原生 `right-triangle`。
- 展开内容使用原生类：`nav-folder`、`nav-file`、`nav-folder-title`、`nav-file-title`、`tree-item-icon collapse-icon`、`nav-folder-children`。
- `styles.css` 没有实际外观声明，因此箭头、间距、颜色和行高跟随 Obsidian 与当前主题。
- 用户要求视觉效果与原生文件目录一致，不能再单独写尺寸、颜色、缩进或箭头位置。

## 文件

- `main.js`：全部交互和渲染逻辑。
- `manifest.json`：插件信息和版本。
- `styles.css`：目前只有说明注释。

## 修改流程

1. 优先修改暂存目录中的源码。
2. 执行 `node --check main.js`。
3. 修改前备份正式安装目录的三个文件。
4. 将 `manifest.json`、`main.js`、`styles.css`复制到正式安装目录。
5. 在 Obsidian 中按 `Ctrl+R` 验证。

## 备份

历史版本位于开发目录下：

- `backup-before-install`
- `backup-v0.1.0-with-icons`
- `backup-v0.1.1-large-chevron`
- `backup-v0.1.2-right-side-root-arrow`

