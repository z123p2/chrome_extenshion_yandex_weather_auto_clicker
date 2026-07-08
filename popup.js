const DEFAULT_CONFIG = {
  enabled: false,
  autoStart: false,
  autoOpenPage: true,
  targetUrl: "https://yandex.ru/pogoda/ru/maps/nowcast?lon=60.493&lat=10.2554&ll=60.493_10.2554&z=5",
  intervalMinutes: 11,
  delayMin: 3,
  delayMax: 10,
};

const $ = (id) => document.getElementById(id);

function readForm() {
  return {
    enabled: $("enabled").checked,
    autoStart: $("autoStart").checked,
    autoOpenPage: $("autoOpenPage").checked,
    targetUrl: $("targetUrl").value.trim(),
    intervalMinutes: parseInt($("intervalMinutes").value) || 10,
    delayMin: parseInt($("delayMin").value) || 30,
    delayMax: parseInt($("delayMax").value) || 60,
  };
}

function writeForm(config) {
  $("enabled").checked = config.enabled;
  $("autoStart").checked = config.autoStart;
  $("autoOpenPage").checked = config.autoOpenPage;
  $("targetUrl").value = config.targetUrl;
  $("intervalMinutes").value = config.intervalMinutes;
  $("delayMin").value = config.delayMin;
  $("delayMax").value = config.delayMax;
}

function updateStatus(status) {
  const dot = $("statusDot");
  const text = $("statusText");
  if (status.enabled) {
    dot.className = "status-dot active";
    text.textContent = "Активно";
  } else {
    dot.className = "status-dot inactive";
    text.textContent = "Неактивно";
  }
  if (status.lastClickTime) {
    const d = new Date(status.lastClickTime);
    const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    $("lastClick").textContent = time;
  } else {
    $("lastClick").textContent = "--:--:--";
  }
}

function sendUpdate(config) {
  chrome.runtime.sendMessage({ action: "updateConfig", config });
}

function fetchStatus() {
  chrome.runtime.sendMessage({ action: "getStatus" }, (status) => {
    if (status) updateStatus(status);
  });
}

chrome.storage.sync.get(DEFAULT_CONFIG, (stored) => {
  const config = { ...DEFAULT_CONFIG, ...stored };
  writeForm(config);
  fetchStatus();
});

$("enabled").addEventListener("change", () => {
  const config = readForm();
  sendUpdate(config);
});

$("autoStart").addEventListener("change", () => {
  const config = readForm();
  sendUpdate(config);
});

$("autoOpenPage").addEventListener("change", () => {
  const config = readForm();
  sendUpdate(config);
});

let debounceTimer;
function debouncedUpdate() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const config = readForm();
    sendUpdate(config);
  }, 400);
}

$("intervalMinutes").addEventListener("input", debouncedUpdate);
$("delayMin").addEventListener("input", debouncedUpdate);
$("delayMax").addEventListener("input", debouncedUpdate);
$("targetUrl").addEventListener("change", () => {
  const config = readForm();
  sendUpdate(config);
});

$("testBtn").addEventListener("click", () => {
  $("testBtn").disabled = true;
  $("testBtn").textContent = "⏳ Выполняется...";
  chrome.runtime.sendMessage({ action: "testClick" }, () => {
    setTimeout(() => {
      $("testBtn").disabled = false;
      $("testBtn").textContent = "▶ Проверить сейчас";
      fetchStatus();
    }, 1000);
  });
});
