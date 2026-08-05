# Bookmark Folder Expand

Expand bookmarked folders directly inside Obsidian's Bookmarks pane, without jumping back to the file explorer.

## Features

- Click a bookmarked folder in the Bookmarks pane to expand/collapse its contents inline
- Recursively expand subfolders
- Click files to open them; Ctrl/Cmd+click or middle-click to open in a new tab
- Active file highlighting inside expanded folders
- Uses the same ordering as Obsidian's File Explorer, including sorting supplied by plugins such as Explorer Sort
- Uses the native Bookmarks item context menu for inline files and folders, including `bookmarks:bookmarks-menu` extensions
- Drag inline files or folders with Obsidian's native drag manager, just like items in the File Explorer
- Drop files and folders onto an expanded folder to move/import them with Obsidian's native drop handling
- File hover preview uses the same Page Preview source and Ctrl/Cmd requirement as native Bookmarks
- Refreshes only currently expanded branches after a file is created, deleted, or renamed
- Persists expanded bookmarked folders and nested folder folds across pane reopen and Obsidian restart
- Follows your current theme — no custom styling

## Performance

- Does not scan the vault at startup
- Does not poll the file system
- Loads only the small saved fold-state file; it never derives fold state by scanning the vault
- Does not render bookmarked folder contents until you expand a folder
- Only direct children are created at each level; subfolders remain lazy until expanded

## Usage

1. Bookmark a folder in Obsidian's Bookmarks pane
2. Click the folder — it expands inline to show its contents
3. Click again to collapse

## Compatibility

- Requires Obsidian ≥ 1.13.0
- Works on desktop and mobile
- Integrates with the current Bookmarks and File Explorer implementations; major Obsidian updates may require a plugin update

## Privacy

This plugin makes no network requests and has no external dependencies at runtime. It operates entirely within your local Obsidian vault.

## License

MIT. See [LICENSE](LICENSE).
