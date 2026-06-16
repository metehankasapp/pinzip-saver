(() => {
  if (window.__pinZipSaverInjected) return;
  window.__pinZipSaverInjected = true;

  const MIN_SIZE = 80;
  const SCAN_INTERVAL_MS = 1200;
  const AUTO_COLLECT_LIMIT = 200;
  const CONTROL_CLASS = "pzs-select-control";
  const BADGE_CLASS = "pzs-resolution-badge";
  const SELECTED_CLASS = "pzs-pin-selected";
  const SELECT_MODE_CLASS = "pzs-select-mode";
  const PROCESSED_ATTR = "data-pzs-ready";

  const selected = new Map();
  let duplicateSkips = 0;
  let autoCollectTimer = null;
  let autoCollectTarget = 0;
  let autoCollectStartY = 0;
  let scanQueued = false;
  let previewDirty = true;
  let toolbarDirty = true;

  function cleanUrl(url) {
    if (!url) return "";
    try {
      return new URL(url, location.href).href;
    } catch {
      return "";
    }
  }

  function isValidHttpUrl(url) {
    return /^https?:\/\//i.test(url || "");
  }

  function sanitizeFileName(name) {
    return (name || "image")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 70) || "image";
  }

  function getPageFolderName() {
    const pathPart = location.pathname
      .split("/")
      .filter(Boolean)
      .slice(-1)[0];
    return sanitizeFileName(pathPart || document.title || "pinzip-images");
  }

  function getExtensionFromUrl(url, contentType = "") {
    const typeMap = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/avif": "avif",
      "image/svg+xml": "svg",
      "image/bmp": "bmp",
    };
    if (typeMap[contentType.toLowerCase()]) return typeMap[contentType.toLowerCase()];

    try {
      const pathname = new URL(url).pathname.toLowerCase();
      const match = pathname.match(/\.(jpg|jpeg|png|webp|gif|avif|svg|bmp)(?:$|\?)/);
      if (match) return match[1] === "jpeg" ? "jpg" : match[1];
    } catch {}
    return "jpg";
  }

  function scoreSrcsetDescriptor(descriptor) {
    if (!descriptor) return 1;
    const value = Number.parseFloat(descriptor);
    if (!Number.isFinite(value)) return 1;
    return descriptor.endsWith("w") ? value / 1000 : value;
  }

  function getBestSrcsetCandidate(srcset) {
    if (!srcset) return null;

    let best = null;
    for (const rawCandidate of srcset.split(",")) {
      const parts = rawCandidate.trim().split(/\s+/);
      const url = cleanUrl(parts[0]);
      if (!url) continue;

      const descriptor = parts[1] || "";
      const score = scoreSrcsetDescriptor(descriptor);
      if (!best || score > best.score) best = { url, descriptor, score };
    }

    return best;
  }

  function getLargestPinterestUrl(url) {
    const cleaned = cleanUrl(url);
    if (!cleaned) return "";

    try {
      const parsed = new URL(cleaned);
      if (!/(\.|^)pinimg\.com$/i.test(parsed.hostname)) return cleaned;

      parsed.pathname = parsed.pathname.replace(
        /\/(?:\d+x|originals)\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]+)\.(jpg|jpeg|png|webp|gif)$/i,
        "/originals/$1/$2/$3/$4.$5"
      );
      return parsed.href;
    } catch {
      return cleaned;
    }
  }

  function getImageInfo(img) {
    const srcsetCandidate = getBestSrcsetCandidate(img.getAttribute("srcset") || img.srcset);
    const fallbackUrl =
      img.getAttribute("data-original") ||
      img.getAttribute("data-src") ||
      img.currentSrc ||
      img.src;
    const sourceUrl = srcsetCandidate?.url || fallbackUrl;
    const url = getLargestPinterestUrl(sourceUrl);
    const key = getImageKey(url);

    return {
      key,
      url,
      title: img.alt || document.title || "image",
      previewUrl: cleanUrl(img.currentSrc || img.src || sourceUrl),
      quality: getQualityLabel(url, srcsetCandidate?.descriptor),
    };
  }

  function getImageKey(url) {
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/\/(?:\d+x|originals)\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]+)\.(jpg|jpeg|png|webp|gif)$/i);
      if (match) return `pinimg:${match[1]}${match[2]}${match[3]}${match[4]}`;
    } catch {}

    return url;
  }

  function getQualityLabel(url, descriptor = "") {
    try {
      const pathname = new URL(url).pathname;
      if (pathname.includes("/originals/")) return "original";
      const match = pathname.match(/\/(\d+x)\//);
      if (match) return match[1];
    } catch {}

    return descriptor || "image";
  }

  function getPinWrapper(img) {
    return (
      img.closest(".PinCard__imageWrapper") ||
      img.closest("[data-test-id='non-story-pin-image']") ||
      img.closest("[data-test-id='pinrep-image']") ||
      img.parentElement
    );
  }

  function isLargeEnough(img) {
    const rect = img.getBoundingClientRect();
    return rect.width >= MIN_SIZE && rect.height >= MIN_SIZE;
  }

  function isVisibleInViewport(el) {
    const rect = el.getBoundingClientRect();
    return (
      rect.width >= MIN_SIZE &&
      rect.height >= MIN_SIZE &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
  }

  function showToast(text) {
    let toast = document.getElementById("pzs-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "pzs-toast";
      document.documentElement.appendChild(toast);
    }

    toast.textContent = text;
    toast.style.display = "block";
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.style.display = "none";
    }, 2200);
  }

  function setSelectMode(enabled) {
    document.documentElement.classList.toggle(SELECT_MODE_CLASS, enabled);
    ensureModeToggle().textContent = enabled ? "Done" : "Select";
    toolbarDirty = true;
    previewDirty = true;
    updateUi();
  }

  function ensureModeToggle() {
    let toggle = document.getElementById("pzs-mode-toggle");
    if (toggle) return toggle;

    toggle = document.createElement("button");
    toggle.id = "pzs-mode-toggle";
    toggle.type = "button";
    toggle.textContent = "Select";
    toggle.title = "Select images for ZIP download";
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectMode(!document.documentElement.classList.contains(SELECT_MODE_CLASS));
    });
    document.documentElement.appendChild(toggle);
    return toggle;
  }

  function ensureToolbar() {
    let toolbar = document.getElementById("pzs-bulk-toolbar");
    if (toolbar) return toolbar;

    toolbar = document.createElement("div");
    toolbar.id = "pzs-bulk-toolbar";
    toolbar.innerHTML = `
      <span id="pzs-selected-count">0 selected</span>
      <button id="pzs-select-visible" type="button">Select visible</button>
      <button id="pzs-auto-collect" type="button">Collect 200</button>
      <button id="pzs-clear-selected" type="button">Clear</button>
      <button id="pzs-download-zip" type="button">Download ZIP</button>
    `;
    document.documentElement.appendChild(toolbar);

    toolbar.querySelector("#pzs-select-visible").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const before = selected.size;
      selectVisibleImages();
      showToast(`Added ${selected.size - before}, skipped ${duplicateSkips} duplicates`);
    });

    toolbar.querySelector("#pzs-auto-collect").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleAutoCollect();
    });

    toolbar.querySelector("#pzs-clear-selected").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearSelection();
    });

    toolbar.querySelector("#pzs-download-zip").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      downloadSelectedAsZip();
    });

    return toolbar;
  }

  function ensurePreviewPanel() {
    let panel = document.getElementById("pzs-preview-panel");
    if (panel) return panel;

    panel = document.createElement("aside");
    panel.id = "pzs-preview-panel";
    panel.innerHTML = `
      <div id="pzs-preview-header">
        <strong>Selected</strong>
        <span id="pzs-preview-meta">0 images</span>
      </div>
      <div id="pzs-preview-grid"></div>
    `;
    document.documentElement.appendChild(panel);
    return panel;
  }

  function updateToolbar() {
    if (!toolbarDirty) return;
    const toolbar = ensureToolbar();
    const count = selected.size;
    const duplicateText = duplicateSkips ? ` | ${duplicateSkips} dupes` : "";
    toolbar.querySelector("#pzs-selected-count").textContent = `${count} selected${duplicateText}`;
    toolbar.classList.toggle(
      "pzs-bulk-toolbar-visible",
      document.documentElement.classList.contains(SELECT_MODE_CLASS)
    );
    toolbarDirty = false;
  }

  function updatePreviewPanel() {
    if (!previewDirty) return;
    const panel = ensurePreviewPanel();
    const grid = panel.querySelector("#pzs-preview-grid");
    const items = Array.from(selected.values());

    panel.classList.toggle(
      "pzs-preview-panel-visible",
      document.documentElement.classList.contains(SELECT_MODE_CLASS) && items.length > 0
    );
    panel.querySelector("#pzs-preview-meta").textContent = `${items.length} images`;

    grid.replaceChildren(
      ...items.slice(-80).map((item) => {
        const tile = document.createElement("div");
        tile.className = "pzs-preview-tile";
        tile.title = item.title;

        const img = document.createElement("img");
        img.src = item.previewUrl || item.url;
        img.alt = "";
        img.loading = "lazy";

        const badge = document.createElement("span");
        badge.textContent = item.quality || "image";

        tile.append(img, badge);
        return tile;
      })
    );
    previewDirty = false;
  }

  function updateUi() {
    updateToolbar();
    updatePreviewPanel();
  }

  function setControlSelected(control, shouldSelect) {
    const wrapper = control.closest("[data-pzs-wrapper='1']");
    const img = wrapper?.querySelector("img");
    const info = img ? getImageInfo(img) : {
      key: control.dataset.pzsKey,
      url: control.dataset.pzsUrl,
      previewUrl: control.dataset.pzsPreviewUrl,
      quality: control.dataset.pzsQuality,
      title: document.title || "image",
    };

    if (!wrapper || !isValidHttpUrl(info.url) || !info.key) return;

    control.dataset.pzsUrl = info.url;
    control.dataset.pzsKey = info.key;
    control.dataset.pzsPreviewUrl = info.previewUrl || info.url;
    control.dataset.pzsQuality = info.quality || "image";

    if (shouldSelect) {
      const wasAlreadyChecked = control.getAttribute("aria-checked") === "true";
      if (selected.has(info.key) && !wasAlreadyChecked) duplicateSkips += 1;
      selected.set(info.key, info);
    } else {
      selected.delete(info.key);
    }

    toolbarDirty = true;
    previewDirty = true;
    syncControlState(control);
  }

  function syncControlState(control) {
    const wrapper = control.closest("[data-pzs-wrapper='1']");
    const img = wrapper?.querySelector("img");
    const info = img ? getImageInfo(img) : {
      key: control.dataset.pzsKey,
      url: control.dataset.pzsUrl,
      previewUrl: control.dataset.pzsPreviewUrl,
      quality: control.dataset.pzsQuality,
      title: document.title || "image",
    };

    if (!wrapper || !isValidHttpUrl(info.url) || !info.key) return;

    control.dataset.pzsUrl = info.url;
    control.dataset.pzsKey = info.key;
    control.dataset.pzsPreviewUrl = info.previewUrl || info.url;
    control.dataset.pzsQuality = info.quality || "image";

    const shouldSelect = selected.has(info.key);
    control.setAttribute("aria-checked", shouldSelect ? "true" : "false");
    wrapper.classList.toggle(SELECTED_CLASS, shouldSelect);

    const badge = wrapper.querySelector(`:scope > .${BADGE_CLASS}`);
    if (badge) badge.textContent = info.quality || "image";
  }

  function clearSelection() {
    selected.clear();
    duplicateSkips = 0;
    document.querySelectorAll(`.${CONTROL_CLASS}`).forEach(syncControlState);
    toolbarDirty = true;
    previewDirty = true;
    updateUi();
  }

  function selectVisibleImages() {
    let changed = false;
    document.querySelectorAll(`.${CONTROL_CLASS}`).forEach((control) => {
      const wrapper = control.closest("[data-pzs-wrapper='1']");
      if (wrapper && isVisibleInViewport(wrapper) && control.getAttribute("aria-checked") !== "true") {
        setControlSelected(control, true);
        changed = true;
      }
    });
    if (changed) {
      toolbarDirty = true;
      previewDirty = true;
    }
    updateUi();
  }

  function toggleAutoCollect() {
    if (autoCollectTimer) {
      stopAutoCollect("Auto collect stopped");
      return;
    }

    setSelectMode(true);
    autoCollectTarget = selected.size + AUTO_COLLECT_LIMIT;
    autoCollectStartY = window.scrollY;
    const button = document.getElementById("pzs-auto-collect");
    button.textContent = "Stop";

    autoCollectTimer = window.setInterval(() => {
      const before = selected.size;
      selectVisibleImages();
      window.scrollBy(0, Math.round(window.innerHeight * 0.82));

      const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80;
      const stuck = before === selected.size && window.scrollY === autoCollectStartY;
      autoCollectStartY = window.scrollY;

      if (selected.size >= autoCollectTarget || nearBottom || stuck) {
        stopAutoCollect(`Collected ${selected.size} images`);
      }
    }, 950);
  }

  function stopAutoCollect(message) {
    if (autoCollectTimer) {
      window.clearInterval(autoCollectTimer);
      autoCollectTimer = null;
    }

    const button = document.getElementById("pzs-auto-collect");
    if (button) button.textContent = "Collect 200";
    if (message) showToast(message);
    toolbarDirty = true;
    updateUi();
  }

  function makeCrc32Table() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  }

  const crc32Table = makeCrc32Table();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = crc32Table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const year = Math.max(date.getFullYear(), 1980);
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
  }

  function writeUint16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function writeUint32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function buildZip(files) {
    const encoder = new TextEncoder();
    const parts = [];
    const centralParts = [];
    const now = dosDateTime(new Date());
    let offset = 0;

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const data = file.data;
      const checksum = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(local.buffer);
      writeUint32(localView, 0, 0x04034b50);
      writeUint16(localView, 4, 20);
      writeUint16(localView, 6, 0x0800);
      writeUint16(localView, 8, 0);
      writeUint16(localView, 10, now.time);
      writeUint16(localView, 12, now.day);
      writeUint32(localView, 14, checksum);
      writeUint32(localView, 18, data.length);
      writeUint32(localView, 22, data.length);
      writeUint16(localView, 26, nameBytes.length);
      writeUint16(localView, 28, 0);
      local.set(nameBytes, 30);
      parts.push(local, data);

      const central = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(central.buffer);
      writeUint32(centralView, 0, 0x02014b50);
      writeUint16(centralView, 4, 20);
      writeUint16(centralView, 6, 20);
      writeUint16(centralView, 8, 0x0800);
      writeUint16(centralView, 10, 0);
      writeUint16(centralView, 12, now.time);
      writeUint16(centralView, 14, now.day);
      writeUint32(centralView, 16, checksum);
      writeUint32(centralView, 20, data.length);
      writeUint32(centralView, 24, data.length);
      writeUint16(centralView, 28, nameBytes.length);
      writeUint16(centralView, 30, 0);
      writeUint16(centralView, 32, 0);
      writeUint16(centralView, 34, 0);
      writeUint16(centralView, 36, 0);
      writeUint32(centralView, 38, 0);
      writeUint32(centralView, 42, offset);
      central.set(nameBytes, 46);
      centralParts.push(central);

      offset += local.length + data.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const centralOffset = offset;
    parts.push(...centralParts);

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    writeUint32(endView, 0, 0x06054b50);
    writeUint16(endView, 4, 0);
    writeUint16(endView, 6, 0);
    writeUint16(endView, 8, files.length);
    writeUint16(endView, 10, files.length);
    writeUint32(endView, 12, centralSize);
    writeUint32(endView, 16, centralOffset);
    writeUint16(endView, 20, 0);
    parts.push(end);

    return new Blob(parts, { type: "application/zip" });
  }

  async function fetchImageFile(image, index, folderName) {
    const response = await fetch(image.url, {
      credentials: "omit",
      cache: "force-cache",
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get("content-type") || "";
    const ext = getExtensionFromUrl(image.url, contentType);
    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);
    const id = image.key?.replace(/^pinimg:/, "").slice(-12) || String(index).padStart(3, "0");
    const name = `${folderName}/${String(index).padStart(3, "0")}-${id}.${ext}`;
    return { name, data };
  }

  async function downloadSelectedAsZip() {
    const images = Array.from(selected.values());
    if (!images.length) {
      showToast("Select images first");
      return;
    }

    stopAutoCollect();
    const zipButton = document.getElementById("pzs-download-zip");
    const originalText = zipButton.textContent;
    zipButton.disabled = true;

    const folderName = getPageFolderName();
    const files = [];
    const failed = [];
    for (let i = 0; i < images.length; i++) {
      zipButton.textContent = `ZIP ${i + 1}/${images.length}`;
      try {
        files.push(await fetchImageFile(images[i], i + 1, folderName));
      } catch {
        failed.push(images[i].url);
      }
    }

    zipButton.textContent = originalText;
    zipButton.disabled = false;

    if (!files.length) {
      showToast("Images could not be fetched for ZIP");
      return;
    }

    if (failed.length) {
      const text = new TextEncoder().encode(failed.join("\n"));
      files.push({ name: `${folderName}/failed-links.txt`, data: text });
    }

    const zip = buildZip(files);
    const zipUrl = URL.createObjectURL(zip);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = zipUrl;
    link.download = `${folderName}-${stamp}.zip`;
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(zipUrl), 30000);

    showToast(`ZIP ready: ${files.length - (failed.length ? 1 : 0)}/${images.length} images`);
  }

  function attachControl(img) {
    if (img.getAttribute(PROCESSED_ATTR) === "1") return;
    if (!isLargeEnough(img)) return;

    const info = getImageInfo(img);
    if (!isValidHttpUrl(info.url) || !info.key) return;

    const wrapper = getPinWrapper(img);
    if (!wrapper || wrapper.querySelector(`:scope > .${CONTROL_CLASS}`)) {
      img.setAttribute(PROCESSED_ATTR, "1");
      return;
    }

    if (getComputedStyle(wrapper).position === "static") wrapper.style.position = "relative";
    wrapper.dataset.pzsWrapper = "1";

    const control = document.createElement("button");
    control.className = CONTROL_CLASS;
    control.type = "button";
    control.title = "Select image";
    control.setAttribute("aria-label", "Select image for ZIP download");
    control.setAttribute("aria-checked", "false");
    control.dataset.pzsUrl = info.url;
    control.dataset.pzsKey = info.key;
    control.dataset.pzsPreviewUrl = info.previewUrl || info.url;
    control.dataset.pzsQuality = info.quality || "image";

    control.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        setControlSelected(control, control.getAttribute("aria-checked") !== "true");
        updateUi();
      },
      true
    );

    const badge = document.createElement("span");
    badge.className = BADGE_CLASS;
    badge.textContent = info.quality || "image";

    wrapper.append(control, badge);
    syncControlState(control);
    img.setAttribute(PROCESSED_ATTR, "1");
  }

  function scanImages() {
    ensureModeToggle();
    ensureToolbar();
    ensurePreviewPanel();
    document.querySelectorAll("img").forEach(attachControl);
    updateUi();
  }

  function requestScan() {
    if (scanQueued) return;
    scanQueued = true;
    window.setTimeout(() => {
      scanQueued = false;
      scanImages();
    }, 350);
  }

  const observer = new MutationObserver(() => requestScan());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "srcset"],
  });

  window.addEventListener("load", requestScan);
  window.addEventListener("resize", requestScan);
  window.addEventListener("beforeunload", () => stopAutoCollect());
  setInterval(requestScan, SCAN_INTERVAL_MS);
  scanImages();
})();
