// @ts-check
const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs');

/** @type {vscode.WebviewPanel | undefined} */
let panel;
/** Messages queued before the webview script has registered its listener */
let pendingMessages = [];
let webviewReady = false;

/**
 * Show or reveal the analysis results webview panel.
 * @param {vscode.ExtensionContext} context
 * @param {object} data - result object to display
 */
function show(context, data) {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside, true);
  } else {
    webviewReady = false;
    pendingMessages = [];
    panel = vscode.window.createWebviewPanel(
      'shieldlyAnalysis',
      'AI-Powered Security Analysis',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webviews')],
        retainContextWhenHidden: true,
      }
    );

    const htmlPath = path.join(context.extensionPath, 'webviews', 'analysis.html');
    panel.webview.html = fs.readFileSync(htmlPath, 'utf8');

    panel.webview.onDidReceiveMessage((msg) => {
      if (msg.command === 'ready') {
        webviewReady = true;
        for (const m of pendingMessages) {
          panel?.webview.postMessage(m);
        }
        pendingMessages = [];
        return;
      }
      if (msg.command === 'openUrl') {
        vscode.env.openExternal(vscode.Uri.parse(msg.url));
      }
      if (msg.command === 'closePanel') {
        panel?.dispose();
      }
    });

    panel.onDidDispose(() => {
      panel = undefined;
      webviewReady = false;
      pendingMessages = [];
    });
  }

  postToWebview({ type: 'result', data });
}

function postToWebview(message) {
  if (!panel) return;
  if (webviewReady) {
    panel.webview.postMessage(message);
  } else {
    // Replace stale same-type message; keep only the latest loading/result state
    const idx = pendingMessages.findIndex((m) => m.type === message.type);
    if (idx !== -1) {
      pendingMessages[idx] = message;
    } else {
      pendingMessages.push(message);
    }
  }
}

/**
 * Show the limit-reached state in the panel.
 * @param {vscode.ExtensionContext} context
 * @param {{ unitsUsed: number, cap: number }} info
 */
function showLimitReached(context, info) {
  show(context, { limitReached: true, ...info });
}

/**
 * Show a loading state in the panel.
 * @param {vscode.ExtensionContext} context
 * @param {string} fileName
 */
function showLoading(context, fileName) {
  show(context, { loading: true, fileName });
}

/**
 * Show a demo mode notice.
 * @param {vscode.ExtensionContext} context
 * @param {number} usesLeft
 */
function showDemoNotice(_context, usesLeft) {
  postToWebview({ type: 'demoNotice', usesLeft });
}

function dispose() {
  panel?.dispose();
  panel = undefined;
  webviewReady = false;
  pendingMessages = [];
}

module.exports = { show, showLimitReached, showLoading, showDemoNotice, dispose };
