const DEFAULT_CONFIG = {
  enabled: false,
  autoStart: false,
  autoOpenPage: true,
  targetUrl: "https://yandex.ru/pogoda/ru/maps/nowcast?lon=60.493&lat=10.2554&ll=60.493_10.2554&z=5",
  intervalMinutes: 11,
  delayMin: 3,
  delayMax: 10,
};

let config = { ...DEFAULT_CONFIG };
let hiddenTabId = null;

function loadConfig() {
  chrome.storage.sync.get(DEFAULT_CONFIG, (stored) => {
    config = { ...DEFAULT_CONFIG, ...stored };
    if (config.enabled) {
      scheduleNext();
    }
  });
}

function scheduleNext(fallbackMinutes) {
  chrome.alarms.clear("autoClick");
  if (fallbackMinutes !== undefined) {
    chrome.alarms.create("autoClick", { delayInMinutes: fallbackMinutes });
    return;
  }
  const randomExtra = Math.random() * (config.delayMax - config.delayMin) + config.delayMin;
  const totalMinutes = config.intervalMinutes + randomExtra / 60;
  chrome.alarms.create("autoClick", { delayInMinutes: totalMinutes });
}

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.sync.get(DEFAULT_CONFIG, (stored) => {
    config = { ...DEFAULT_CONFIG, ...stored };
    if (config.autoStart) {
      config.enabled = true;
      chrome.storage.sync.set({ enabled: true });
      scheduleNext();
    } else {
      config.enabled = false;
    }
  });
});

chrome.runtime.onInstalled.addListener(() => {
  loadConfig();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "autoClick") {
    scheduleNext();
    handleAutoClick().catch(() => {});
  }
});

async function ensureHiddenTab() {
  if (hiddenTabId) {
    try {
      await chrome.tabs.get(hiddenTabId);
      return hiddenTabId;
    } catch {
      hiddenTabId = null;
    }
  }

  const tab = await chrome.tabs.create({
    url: "about:blank",
    active: false,
    pinned: true,
  });
  hiddenTabId = tab.id;
  return hiddenTabId;
}

async function handleAutoClick() {
  const urlPattern = "https://yandex.ru/pogoda/*";
  let tabs = await chrome.tabs.query({ url: urlPattern });
  let clicked = false;

  if (tabs.length === 0 && config.autoOpenPage) {
    try {
      const tabId = await ensureHiddenTab();
      if (!tabId) return;

      await chrome.tabs.update(tabId, { url: config.targetUrl, active: false });

      try {
        await waitForTabLoad(tabId, 30000);
      } catch {}
      await delay(3000);
      const response = await chrome.tabs.sendMessage(tabId, { action: "click" }).catch(() => null);

      if (response && response.success) {
        await chrome.storage.local.set({ lastClickTime: Date.now() });
        clicked = true;
      }

      await delay(500);
      await chrome.tabs.discard(tabId);
    } catch {}
  } else if (tabs.length > 0) {
    for (const tab of tabs) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: "click" }).catch(() => null);
        if (response && response.success) {
          await chrome.storage.local.set({ lastClickTime: Date.now() });
          clicked = true;
          break;
        }
      } catch {}
    }
  }

  if (clicked) {
    scheduleNext();
  } else {
    scheduleNext(3);
  }
}

function waitForTabLoad(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timeout"));
    }, timeoutMs);
    function listener(tabId_, info) {
      if (tabId_ === tabId && info.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "updateConfig") {
    config = { ...config, ...message.config };
    chrome.storage.sync.set(config);
    chrome.alarms.clear("autoClick");
    if (config.enabled) {
      scheduleNext();
    }
    if (!config.enabled) {
      chrome.storage.local.set({ lastClickTime: null });
    }
    sendResponse({ success: true });
  }
  if (message.action === "testClick") {
    handleAutoClick()
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }
  if (message.action === "getStatus") {
    chrome.storage.local.get("lastClickTime", (data) => {
      sendResponse({
        enabled: config.enabled,
        lastClickTime: data.lastClickTime || null,
      });
    });
    return true;
  }
});

loadConfig();
