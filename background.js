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

function log(msg) {
  const ts = new Date().toLocaleTimeString("ru-RU");
  console.log(`[${ts}] ${msg}`);
  chrome.storage.local.get("logs", (data) => {
    const logs = data.logs || [];
    logs.push({ ts: Date.now(), msg });
    if (logs.length > 50) logs.splice(0, logs.length - 50);
    chrome.storage.local.set({ logs });
  });
}

function loadConfig() {
  chrome.storage.sync.get(DEFAULT_CONFIG, (stored) => {
    config = { ...DEFAULT_CONFIG, ...stored };
    log("loadConfig: loaded, enabled=" + config.enabled);
  });
}

function scheduleNext(fallbackMinutes) {
  chrome.alarms.clear("autoClick");
  if (fallbackMinutes !== undefined) {
    chrome.alarms.create("autoClick", { delayInMinutes: fallbackMinutes });
    const next = new Date(Date.now() + fallbackMinutes * 60000);
    const nextStr = next.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    log(`scheduleNext: retry at ${nextStr}, in ${fallbackMinutes} min`);
    return;
  }
  const randomExtra = Math.random() * (config.delayMax - config.delayMin) + config.delayMin;
  const totalMinutes = config.intervalMinutes + randomExtra / 60;
  chrome.alarms.create("autoClick", { delayInMinutes: totalMinutes });
  const next = new Date(Date.now() + totalMinutes * 60000);
  const nextStr = next.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  log(`scheduleNext: next at ${nextStr}, in ${totalMinutes.toFixed(1)} min`);
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
  chrome.storage.sync.get(DEFAULT_CONFIG, (stored) => {
    config = { ...DEFAULT_CONFIG, ...stored };
    log("onInstalled: loaded, enabled=" + config.enabled);
    if (config.enabled) {
      scheduleNext();
    }
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "autoClick") {
    log("ALARM: autoClick fired");
    scheduleNext();
    handleAutoClick().catch(() => log("handleAutoClick: unhandled rejection"));
  }
});

async function ensureHiddenTab() {
  if (hiddenTabId) {
    try {
      await chrome.tabs.get(hiddenTabId);
      log("ensureHiddenTab: reuse cached id " + hiddenTabId);
      return hiddenTabId;
    } catch {
      log("ensureHiddenTab: cache invalid, drop");
      hiddenTabId = null;
    }
  }

  const tabs = await chrome.tabs.query({ pinned: true, url: "about:blank" });
  const existing = tabs.find(t => !t.active);
  if (existing) {
    hiddenTabId = existing.id;
    log("ensureHiddenTab: found existing tab " + hiddenTabId);
    return hiddenTabId;
  }

  log("ensureHiddenTab: create new pinned tab");
  const tab = await chrome.tabs.create({
    url: "about:blank",
    active: false,
    pinned: true,
  });
  hiddenTabId = tab.id;
  return hiddenTabId;
}

async function handleAutoClick() {
  log("handleAutoClick: start");
  const urlPattern = "https://yandex.ru/pogoda/*";
  let tabs = await chrome.tabs.query({ url: urlPattern });
  log(`handleAutoClick: found ${tabs.length} existing tabs`);
  let clicked = false;

  if (tabs.length === 0 && config.autoOpenPage) {
    try {
      const tabId = await ensureHiddenTab();
      if (!tabId) { log("handleAutoClick: no tabId, return"); return; }

      log("handleAutoClick: navigate to target URL");
      await chrome.tabs.update(tabId, { url: config.targetUrl, active: false });

      log("handleAutoClick: wait for load");
      try {
        await waitForTabLoad(tabId, 30000);
        log("handleAutoClick: load complete");
      } catch {
        log("handleAutoClick: waitForTabLoad timeout");
      }
      await delay(3000);
      log("handleAutoClick: send click message");
      const response = await chrome.tabs.sendMessage(tabId, { action: "click" }).catch(() => null);

      if (response && response.success) {
        log("handleAutoClick: click SUCCESS");
        await chrome.storage.local.set({ lastClickTime: Date.now() });
        clicked = true;
      } else {
        log("handleAutoClick: click FAILED (response=" + JSON.stringify(response) + ")");
      }

      await delay(500);
      log("handleAutoClick: reset to about:blank");
      await chrome.tabs.update(tabId, { url: "about:blank", active: false });
    } catch (e) {
      log("handleAutoClick: error in autoOpen block: " + e.message);
    }
  } else if (tabs.length > 0) {
    log("handleAutoClick: trying existing tabs");
    for (const tab of tabs) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: "click" }).catch(() => null);
        if (response && response.success) {
          log("handleAutoClick: click SUCCESS on existing tab " + tab.id);
          await chrome.storage.local.set({ lastClickTime: Date.now() });
          clicked = true;
          break;
        }
      } catch (e) {
        log("handleAutoClick: error on tab " + tab.id + ": " + e.message);
      }
    }
    if (!clicked) log("handleAutoClick: no existing tab succeeded");
  } else {
    log("handleAutoClick: no tabs and autoOpenPage disabled");
  }

  if (clicked) {
    log("handleAutoClick: schedule normal");
    scheduleNext();
  } else {
    log("handleAutoClick: schedule retry 3min");
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
    chrome.storage.local.get("lastClickTime", (lcData) => {
      chrome.storage.sync.get(DEFAULT_CONFIG, (stored) => {
        sendResponse({
          enabled: stored.enabled || false,
          lastClickTime: lcData.lastClickTime || null,
        });
      });
    });
    return true;
  }
  if (message.action === "getLogs") {
    chrome.storage.local.get("logs", (data) => {
      sendResponse(data.logs || []);
    });
    return true;
  }
  if (message.action === "clearLogs") {
    chrome.storage.local.set({ logs: [] });
    sendResponse({ success: true });
  }
});
