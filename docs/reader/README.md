# Preview the documentation

From the ClipCraft repository root, install the reader’s pinned dependencies and build the local HTML.

```sh
npm ci --prefix docs/reader
npm run --prefix docs/reader build
```

Open `docs/reader/dist/docs/README.html` in a browser. The handbook, SDK tutorials and API reference share a sidebar and local search. Source links and media resolve within this checkout. The build needs no running application or web server.

Edit the original Markdown to change an article. Add primary pages to `navigation.mjs` and rebuild after changes. The reader also renders Markdown reached through links from those pages.
