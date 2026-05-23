# Chrome Web Store Listing — Data Extractor

> Last Updated: 2026-05-22

## Store Listing

**Extension Name**
Data Extractor

**Short Description**
Extracts webpage content and YouTube details into token-optimized Markdown, ready to copy-paste into LLMs.

**Detailed Description**
Data Extractor is a productivity tool designed to bridge the gap between webpages and AI models. It runs directly inside your Chrome Side Panel, allowing you to scrape page content, clean it, and format it into compact Markdown that is optimized for LLMs, saving you valuable tokens.

Features:
- One-Click Auto-Scraper: Instantly extracts headings, lists, tables, links, and body paragraphs.
- YouTube Specialist: Detects when you are watching a video and extracts the title, channel name, statistics, description, and comment text.
- Interactive Visual Selector: Toggle selector mode and click on any element on the page to target and extract it.
- Token Optimization: Strips out script files, styles, classes, and boilerplate noise, reducing document size by up to 80% to conserve context tokens.
- Visual Auto-Scraper: Runs a live, element-by-element scrolling and highlighting walkthrough of the page with a Stop & Save feature.

How to use it:
1. Pin the Data Extractor in your toolbar.
2. Click the icon to open the Side Panel interface.
3. On any website (e.g., a documentation page, a Wikipedia article, or a YouTube video), click "Auto Scrape Page".
4. Alternately, click "Visual Selector" and hover/click on the exact block of text you want to scrape.
5. In the side panel, review the extracted structure in the "Preview" tab, or copy the clean Markdown from the "Optimized MD" tab.
6. Paste the clean, compact data directly into your AI session.

Privacy and Security:
All extraction runs locally inside your browser. No data is stored, collected, or transmitted to any external servers.

**Category**
Productivity / Developer Tools

**Single Purpose**
Extracts and structures webpage content into token-optimized Markdown for AI input.

**Primary Language**
English


## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon | 128×128 PNG | ⬜ Not created | Omitted (uses default) |
| Screenshot 1 | 1280×800 | ⬜ Not created | |
| Screenshot 2 | 1280×800 | ⬜ Not created | |


## Permissions Justification

Every permission used by this extension is restricted to local operations to protect user data:

| Permission | Type | Justification |
|------------|------|---------------|
| `sidePanel` | permissions | Required to register and display the side panel UI housing the controls and scraper results. |
| `tabs` | permissions | Required to retrieve the URL and title of the active tab, so the extension can show what site is being scraped and communicate with the correct tab. |
| `storage` | permissions | Required to preserve side panel state across tab transitions. |
| `http://*/*`, `https://*/*` | host_permissions | Required to inject and run the content script dynamically to extract DOM elements, tables, and YouTube details on webpages visited by the user. |


## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes


## Privacy Policy

**Privacy Policy URL**
https://github.com/rikeee9980/portfolio/blob/main/privacy-policy.md (Example placeholder matching the repository)


## Distribution

**Visibility**: Public
**Regions**: All regions
**Pricing**: Free


## Developer Info

**Publisher Name**
Developer Tools Inc.

**Contact Email**
developer@example.com

**Support URL / Email**
https://github.com/rikeee9980/portfolio/issues


## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.0 | 2026-05-22 | Initial release with Auto-Scraper, YouTube detection, visual selector, and token optimizer. | Draft |
