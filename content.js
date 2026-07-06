chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "click") {
    waitForButton(sendResponse);
    return true;
  }
});

function waitForButton(sendResponse) {
  let attempts = 0;
  const maxAttempts = 30;

  function poll() {
    const button = findButton();
    if (button) {
      button.click();
      sendResponse({ success: true });
      return;
    }
    attempts++;
    if (attempts >= maxAttempts) {
      sendResponse({ success: false });
      return;
    }
    setTimeout(poll, 500);
  }

  poll();
}

function findButton() {
  const primary = document.querySelector('button[data-val="wrong"]');
  if (primary) return primary;

  const buttons = document.querySelectorAll("button");
  return Array.from(buttons).find(
    (b) => b.textContent.trim() === "Нет"
  );
}
