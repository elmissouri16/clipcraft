# Plugin management layout

The Installed task uses a compact searchable inventory beside a stable detail
pane. The inventory shows identity, publisher and enable state; the detail pane
shows the full name, publisher verification, version, description, activation and
that extension's registered native settings. This replaces inline expanding rows
and the aggregate settings forms that previously appeared above the inventory.

Search matches name, publisher and exact package ID. Type and status filters help
separate executable extensions, creative packs and packages needing attention.
Empty results offer a clear filter reset. Long names truncate only in the list;
the full selected identity wraps in the detail pane. Each column scrolls without
moving the other. The wider plugin settings sheet still fits the minimum editor
window. Pack browsing and creation retain their existing task owners; changing
views does not cancel running jobs.

Commands and technical package maintenance are secondary disclosures. Required
pack dependencies and global recovery/storage maintenance remain reachable below
the manager. Plugin settings are filtered by their actual extension ID across
registered settings locations. Selecting an already-trusted extension activates
only that package to restore its configuration after package changes. Explicit
Stop and missing trust are respected; selection grants no new access. The existing Voice and export settings surfaces
keep their specialized integrations as well.

## Research and original implementation

- [VS Code extension management](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace): searchable identities, a selected extension detail view and separate enable/uninstall actions.
- [GNOME sidebars](https://developer.gnome.org/hig/patterns/nav/sidebars.html): list controls belong above their list; identity artwork and concise row text aid navigation.
- [Nielsen Norman Group: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): keep frequent configuration visible and defer maintenance and technical options.

These inform task organization only. ClipCraft's markup, layout, wording and
visual treatment are original and use its flat desktop tokens and controls.

## Package identity artwork

The optional manifest field `icon: "assets/identity.png"` works for Node extensions
and creative packs. SDK sources store it under `src/assets/`. Static PNGs are
bounded to 256 KiB and 1024×1024 pixels, verified before admission and included in
the package fingerprint. No remote icon loads or extension execution are needed.
The native icon read verifies immutable package bytes again. A bounded renderer
cache holds at most 32 images. Missing artwork or decoder failure uses a stable
monogram with a tint drawn from existing design tokens. No vendor logo is invented.

See `tests/unit/plugins/test-plugin-icons.cjs` and the real Electron
`test-plugin-settings-ui.cjs` workflow for package and UI verification.

Older retained versions without artwork may display the verified icon of another
installed version with the same package ID and publisher. Their own immutable
manifest, executable bytes and rendering digest remain unchanged.
