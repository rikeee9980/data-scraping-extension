// Background service worker for Data Extractor

// Configure the side panel to open when the extension icon in the toolbar is clicked
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("Error setting side panel behavior:", error));
});
