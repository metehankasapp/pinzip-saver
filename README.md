# PinZip Saver

PinZip Saver is a lightweight Chrome extension for collecting image pins from Pinterest pages and saving the largest available versions into one ZIP file.

It is designed for personal archiving of content you can already view in your browser. It does not bypass private accounts, paywalls, or site access controls.

## Features

- Selection mode keeps checkboxes hidden until you need them.
- Preview panel shows selected thumbnails even when infinite scroll removes pins from the page.
- `Select visible` selects only the pins currently in the viewport.
- `Collect 200` auto-scrolls and selects loaded pins.
- Duplicate detection uses Pinterest image hashes.
- Resolution/source badges show values like `original` or `736x`.
- ZIP output uses a page-based folder and stable numbered filenames.
- Blocked image fetches are written to `failed-links.txt` inside the ZIP.

## Install Locally

1. Download or clone this repository.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the extension folder containing `manifest.json`.

## Usage

1. Open a Pinterest board, feed, profile, or search page.
2. Click **Select** in the lower-left corner.
3. Select pins manually, click **Select visible**, or use **Collect 200**.
4. Review selected thumbnails in the preview panel.
5. Click **Download ZIP**.

## Privacy And Permissions

- Runs only on `pinterest.com` pages.
- Requests image access for `pinimg.com`.
- Does not use a background service worker.
- Does not request Chrome's `downloads` permission.
- Creates ZIP files locally in the page context and triggers a normal browser download.
- Does not send selected URLs or images to a third-party server.

## Limitations

Some images may be protected by site or browser fetch rules. When that happens, PinZip Saver still creates the ZIP for images it can fetch and includes blocked URLs in `failed-links.txt`.

## License

MIT
