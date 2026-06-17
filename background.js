chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "PZS_FETCH_IMAGE") return false;

  fetchImage(message.url)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Fetch failed",
      });
    });

  return true;
});

async function fetchImage(url) {
  if (!/^https:\/\/[^/]*pinimg\.com\//i.test(url)) {
    throw new Error("Unsupported image host");
  }

  const response = await fetch(url, {
    credentials: "omit",
    cache: "force-cache",
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const buffer = await response.arrayBuffer();
  return {
    ok: true,
    contentType: response.headers.get("content-type") || "",
    bytes: Array.from(new Uint8Array(buffer)),
  };
}
