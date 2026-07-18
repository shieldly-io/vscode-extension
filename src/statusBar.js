// @ts-check
const vscode = require('vscode');

const PREFIX = '$(shield) Shieldly AI';

let statusBarItem;

function getItem() {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'shieldly.showLastResult';
    statusBarItem.tooltip = 'Shieldly AI-Powered Security Analysis — click to view last result';
    statusBarItem.show();
  }
  return statusBarItem;
}

const SOURCE_LABELS = {
  env: 'via SHIELDLY_API_KEY',
  config: 'via ~/.shieldly/config.json',
};

/**
 * @param {string|null} apiKey
 * @param {'vscode'|'env'|'config'|null} [source]
 */
function setIdle(apiKey, source) {
  const item = getItem();
  item.text = PREFIX;
  const sourceHint = source && SOURCE_LABELS[source] ? ` (${SOURCE_LABELS[source]})` : '';
  item.tooltip = apiKey
    ? `Shieldly AI: ready${sourceHint} — open a JSON policy file and run analysis`
    : 'Shieldly AI: demo mode — 5 free analyses, no signup required';
  item.backgroundColor = undefined;
}

function setAnalyzing() {
  const item = getItem();
  item.text = `$(sync~spin) Shieldly AI: analyzing…`;
  item.backgroundColor = undefined;
}

function setScore(score, riskLevel) {
  const item = getItem();
  item.text = `${PREFIX}: ${score}`;
  const colors = {
    Critical: new vscode.ThemeColor('statusBarItem.errorBackground'),
    High: new vscode.ThemeColor('statusBarItem.warningBackground'),
  };
  item.backgroundColor = colors[riskLevel] ?? undefined;
  item.tooltip = `Shieldly AI: score ${score}/100, risk ${riskLevel} — click to view findings`;
}

function setLimitReached() {
  const item = getItem();
  item.text = `${PREFIX}: limit reached`;
  item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  item.tooltip = 'Daily analysis limit reached — enable PAYG or upgrade your plan';
}

function setError() {
  const item = getItem();
  item.text = `${PREFIX}: error`;
  item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  item.tooltip = 'Shieldly AI: analysis failed — check Output panel for details';
}

function dispose() {
  statusBarItem?.dispose();
  statusBarItem = undefined;
}

module.exports = { setIdle, setAnalyzing, setScore, setLimitReached, setError, dispose };
