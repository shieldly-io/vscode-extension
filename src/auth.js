// @ts-check
const vscode = require('vscode');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SECRET_KEY = 'shieldly.apiKey';

// On macOS, VS Code launched from Dock/Spotlight doesn't inherit shell env vars
// (.zshrc / .zprofile). Spawn a login shell once and cache the result.
let _shellKeyPromise = null;

function getShellKey() {
  if (_shellKeyPromise) return _shellKeyPromise;
  _shellKeyPromise = new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh';
    let settled = false;
    const done = (val) => {
      if (!settled) {
        settled = true;
        resolve(val ? val.trim() : null);
      }
    };
    const timer = setTimeout(() => done(null), 3000);
    try {
      const child = execFile(
        shell,
        ['-l', '-i', '-c', 'printf "%s" "$SHIELDLY_API_KEY"'],
        { timeout: 3000 },
        (err, stdout) => {
          clearTimeout(timer);
          done(err ? null : stdout);
        }
      );
      child.stderr?.resume();
    } catch {
      clearTimeout(timer);
      done(null);
    }
  });
  return _shellKeyPromise;
}

const DEMO_COUNT_KEY = 'shieldly.demoCount';
const DEMO_LIMIT = 5;

// Mirrors CLI utils.js CONFIG_PATH so both tools share the same config file.
const CLI_CONFIG_PATH = path.join(os.homedir(), '.shieldly', 'config.json');

/**
 * Read the API key from ~/.shieldly/config.json (same file the CLI writes).
 * @returns {string|null}
 */
function readCliConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CLI_CONFIG_PATH, 'utf8'));
    return cfg.apiKey || null;
  } catch {
    return null;
  }
}

/**
 * Get the stored API key. Priority order (mirrors CLI utils.js):
 *   1. VS Code SecretStorage (set via "Shieldly: Set API Key" command)
 *   2. SHIELDLY_API_KEY environment variable (process env)
 *   3. SHIELDLY_API_KEY from login shell (for GUI-launched VS Code on macOS)
 *   4. ~/.shieldly/config.json (shared with CLI)
 * @param {vscode.ExtensionContext} context
 * @returns {Promise<string|null>}
 */
async function getApiKey(context) {
  const stored = await context.secrets.get(SECRET_KEY);
  if (stored) return stored;
  if (process.env.SHIELDLY_API_KEY) return process.env.SHIELDLY_API_KEY;
  const shellKey = await getShellKey();
  if (shellKey) return shellKey;
  return readCliConfig();
}

/**
 * Get the API key with its source so the UI can explain where it came from.
 * @param {vscode.ExtensionContext} context
 * @returns {Promise<{ key: string|null, source: 'vscode'|'env'|'config'|null }>}
 */
async function getApiKeyWithSource(context) {
  const stored = await context.secrets.get(SECRET_KEY);
  if (stored) return { key: stored, source: 'vscode' };
  if (process.env.SHIELDLY_API_KEY) return { key: process.env.SHIELDLY_API_KEY, source: 'env' };
  const shellKey = await getShellKey();
  if (shellKey) return { key: shellKey, source: 'env' };
  const cfg = readCliConfig();
  if (cfg) return { key: cfg, source: 'config' };
  return { key: null, source: null };
}

/**
 * Prompt for and store an API key.
 * @param {vscode.ExtensionContext} context
 * @returns {Promise<string|null>} the saved key, or null if cancelled
 */
async function promptSetApiKey(context) {
  const key = await vscode.window.showInputBox({
    title: 'Shieldly API Key',
    prompt: 'Enter your Shieldly API key (generate one at shieldly.io/app/settings)',
    placeHolder: 'sk_live_...',
    password: true,
    ignoreFocusOut: true,
    validateInput(v) {
      if (!v?.startsWith('sk_')) return 'API key must start with sk_';
      if (v.length < 20) return 'Key too short';
      return null;
    },
  });
  if (!key) return null;
  await context.secrets.store(SECRET_KEY, key);
  await vscode.window.showInformationMessage('Shieldly API key saved. You now have full access.');
  return key;
}

/**
 * Clear the stored API key and reset demo counter.
 * @param {vscode.ExtensionContext} context
 */
async function clearApiKey(context) {
  await context.secrets.delete(SECRET_KEY);
  await context.globalState.update(DEMO_COUNT_KEY, 0);
  vscode.window.showInformationMessage(
    'Shieldly API key cleared. Demo mode re-activated (5 free uses).'
  );
}

/**
 * Check whether demo mode is available WITHOUT incrementing the counter.
 * Call this before the API request to gate access.
 * @param {vscode.ExtensionContext} context
 * @returns {{ allowed: boolean, usesLeft: number }}
 */
function checkDemoUsage(context) {
  const count = context.globalState.get(DEMO_COUNT_KEY, 0);
  if (count >= DEMO_LIMIT) return { allowed: false, usesLeft: 0 };
  return { allowed: true, usesLeft: DEMO_LIMIT - count };
}

/**
 * Consume one demo credit. Call this AFTER a successful API response
 * so that failed/network-error attempts do not permanently burn credits.
 * @param {vscode.ExtensionContext} context
 * @returns {number} remaining uses after this consumption
 */
function consumeDemoUsage(context) {
  const count = context.globalState.get(DEMO_COUNT_KEY, 0);
  const next = Math.min(count + 1, DEMO_LIMIT);
  context.globalState.update(DEMO_COUNT_KEY, next);
  return Math.max(0, DEMO_LIMIT - next);
}

/**
 * Returns remaining demo uses without incrementing.
 * @param {vscode.ExtensionContext} context
 */
function getDemoUsesLeft(context) {
  const count = context.globalState.get(DEMO_COUNT_KEY, 0);
  return Math.max(0, DEMO_LIMIT - count);
}

module.exports = {
  getApiKey,
  getApiKeyWithSource,
  promptSetApiKey,
  clearApiKey,
  checkDemoUsage,
  consumeDemoUsage,
  getDemoUsesLeft,
  DEMO_LIMIT,
};
