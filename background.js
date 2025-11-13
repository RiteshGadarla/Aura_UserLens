chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
  }
});
chrome.storage.sync.get(['finger_enabled'], res => {
  const enabled = res.finger_enabled !== false;
  chrome.declarativeContent?.onPageChanged.removeRules(undefined, () => {
    chrome.declarativeContent.onPageChanged.addRules([{
      conditions: [new chrome.declarativeContent.PageStateMatcher({})],
      actions: [new chrome.declarativeContent.RequestContentScript({
        js: enabled ? ['finger-control.js'] : []
      })]
    }]);
  });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.finger_enabled) {
    chrome.tabs.reload();
  }
});