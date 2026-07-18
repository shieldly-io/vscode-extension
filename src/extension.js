// @ts-check
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const {
  getApiKey,
  getApiKeyWithSource,
  promptSetApiKey,
  clearApiKey,
  checkDemoUsage,
  consumeDemoUsage,
  getDemoUsesLeft,
} = require('./auth');
const { analyzeIAM } = require('./api');
const statusBar = require('./statusBar');
const diagnostics = require('./diagnostics');
const panel = require('./panel');
const { isIAMPolicy, isCFTemplate, extractIAMResources } = require('./cfParser');
const { calculateMultiplier } = require('./multiplier');

/** @type {object | undefined} */
let lastResult;

const POLICY_EXTS = new Set(['.json', '.yaml', '.yml']);
const AUTO_ANALYZE_SETTING = 'shieldly.autoAnalyze';
const API_URL_SETTING = 'shieldly.apiUrl';
const DEFAULT_API_URL = 'https://api.shieldly.io';

function getApiUrl() {
  // VS Code setting (if user explicitly changed it) > SHIELDLY_API_URL env var > default
  const configured = vscode.workspace.getConfiguration().inspect(API_URL_SETTING);
  const explicit =
    configured?.globalValue || configured?.workspaceValue || configured?.workspaceFolderValue;
  if (explicit) return String(explicit).replace(/\/$/, '');
  if (process.env.SHIELDLY_API_URL) return process.env.SHIELDLY_API_URL.replace(/\/$/, '');
  return DEFAULT_API_URL;
}

/**
 * Determine whether a document looks like an AWS policy file we should analyze.
 * Returns the policy JSON string and detected policyType, or null if not applicable.
 * @param {vscode.TextDocument} doc
 * @returns {{ policyText: string, policyType: string, label: string } | null}
 */
function extractPolicy(doc) {
  const text = doc.getText();
  if (!text.trim()) return null;

  // YAML CF templates: require a Resources: section to avoid sending GitHub Actions,
  // docker-compose, and other YAML files to the CF analyzer.
  const isYaml = doc.fileName.endsWith('.yaml') || doc.fileName.endsWith('.yml');
  if (isYaml) {
    if (!text.includes('Resources:')) return null;
    return { policyText: text, policyType: 'cf', label: 'CloudFormation Template' };
  }

  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }

  if (isIAMPolicy(obj)) {
    return { policyText: text, policyType: 'iam_identity', label: 'IAM Policy' };
  }

  if (isCFTemplate(obj)) {
    const resources = extractIAMResources(obj);
    if (!resources.length) return null;
    return { policyText: text, policyType: 'cf', label: 'CloudFormation Template' };
  }

  return null;
}

/**
 * Core analysis flow.
 * @param {vscode.ExtensionContext} context
 * @param {vscode.TextDocument} doc
 * @param {boolean} [explicit] - true when user invoked directly (show warnings on no-op)
 */
async function analyzeFile(context, doc, explicit = false) {
  const extracted = extractPolicy(doc);
  if (!extracted) {
    if (explicit) {
      const text = doc.getText().trim();
      const isYaml = doc.fileName.endsWith('.yaml') || doc.fileName.endsWith('.yml');
      if (isYaml) {
        vscode.window.showWarningMessage(
          'Shieldly: File does not appear to be a CloudFormation template. Ensure it contains a "Resources:" section with AWS resources.'
        );
        return;
      }
      let obj;
      try {
        obj = JSON.parse(text);
      } catch {
        // not JSON
      }
      if (!obj) {
        vscode.window.showWarningMessage(
          'Shieldly: File is not valid JSON. Open an IAM policy or CloudFormation template (.json, .yaml, .yml).'
        );
      } else if (isCFTemplate(obj)) {
        vscode.window.showWarningMessage(
          'Shieldly: CloudFormation template has no IAM resources (Roles, Users, Groups, Policies, ManagedPolicies) to analyze.'
        );
      } else {
        vscode.window.showWarningMessage(
          'Shieldly: File is not an IAM policy document or CloudFormation template with IAM resources.'
        );
      }
    }
    return;
  }

  const { policyText, policyType, label } = extracted;
  const fileName = path.basename(doc.fileName);

  // Size gate
  const { reject, reason } = calculateMultiplier(policyType === 'cf' ? 'cf' : 'iam', policyText);
  if (reject) {
    vscode.window.showWarningMessage(`Shieldly: File too large to analyze — ${reason}`);
    return;
  }

  const apiKey = await getApiKey(context);

  // Demo mode gate
  if (!apiKey) {
    const demo = checkDemoUsage(context);
    if (!demo.allowed) {
      statusBar.setLimitReached();
      panel.showLimitReached(context, { unitsUsed: 5, cap: 5, demo: true });
      return;
    }
  }

  // Show loading state
  statusBar.setAnalyzing();
  panel.showLoading(context, fileName);

  const result = await analyzeIAM({
    policy: policyText,
    policyType,
    apiKey: apiKey ?? undefined,
    apiUrl: getApiUrl(),
  });

  if (!result.success) {
    if (result.limitReached) {
      statusBar.setLimitReached();
      panel.showLimitReached(context, { unitsUsed: 0, cap: 0, demo: !apiKey });
    } else {
      statusBar.setError();
      vscode.window.showErrorMessage(`Shieldly: Analysis failed — ${result.error}`);
    }
    return;
  }

  const data = result.result ?? {};
  const score = data.score ?? null;
  const riskLevel = data.riskLevel ?? data.overallRisk ?? 'Low';

  lastResult = { ...data, fileName, label };

  statusBar.setScore(score !== null ? String(score) : '—', riskLevel);
  diagnostics.publishDiagnostics(doc, data.findings ?? []);
  panel.show(context, lastResult);

  // Demo notice — consume credit AFTER confirmed success so failures don't burn quota.
  // Cache hits consume no server quota, so don't burn a local credit for them either.
  // Display the server-reported remaining when present (authoritative across reinstalls/IPs).
  if (!apiKey) {
    const serverLeft = data.demoInfo?.analysesRemaining;
    let usesLeft;
    if (typeof serverLeft === 'number') usesLeft = serverLeft;
    else if (data.cached) usesLeft = getDemoUsesLeft(context);
    else usesLeft = consumeDemoUsage(context);
    panel.showDemoNotice(context, usesLeft);
    if (usesLeft === 0) {
      vscode.window
        .showInformationMessage(
          'Shieldly: You have used all your free demo analyses. Set an API key to continue.',
          'Set API Key'
        )
        .then((choice) => {
          if (choice === 'Set API Key') promptSetApiKey(context);
        });
    } else {
      vscode.window
        .showInformationMessage(
          `Shieldly: ${usesLeft} free demo ${usesLeft === 1 ? 'analysis' : 'analyses'} remaining.`,
          'Get Full Access'
        )
        .then((choice) => {
          if (choice === 'Get Full Access')
            vscode.env.openExternal(vscode.Uri.parse('https://www.shieldly.io/sign-up'));
        });
    }
  }
}

/**
 * Scan a directory for CDK/CF template files and analyze each with IAM resources.
 * @param {vscode.ExtensionContext} context
 * @param {string} dirPath
 */
async function scanDirectory(context, dirPath) {
  // Use CDK manifest.json when available — authoritative list of current-synthesis stacks only.
  let templates = [];
  try {
    const manifestRaw = fs.readFileSync(path.join(dirPath, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw);
    if (manifest.artifacts && typeof manifest.artifacts === 'object') {
      templates = Object.values(manifest.artifacts)
        .filter((a) => a.type === 'aws:cloudformation:stack' && a.properties?.templateFile)
        .map((a) => path.join(dirPath, a.properties.templateFile));
    }
  } catch {
    // No manifest — fall back to glob
  }

  if (templates.length === 0) {
    // Fallback: scan for *.template.json (non-CDK CF directories)
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      vscode.window.showErrorMessage(`Shieldly: Cannot read directory: ${dirPath}`);
      return;
    }
    templates = entries
      .filter((e) => e.isFile() && e.name.endsWith('.template.json'))
      .map((e) => path.join(dirPath, e.name));
  }

  if (templates.length === 0) {
    vscode.window.showWarningMessage(
      `Shieldly: No *.template.json files found in ${path.basename(dirPath)}. Run "cdk synth" first.`
    );
    return;
  }

  // Filter to only those with IAM resources
  const qualifying = templates.filter((filePath) => {
    try {
      const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return isCFTemplate(obj) && extractIAMResources(obj).length > 0;
    } catch {
      return false;
    }
  });

  if (qualifying.length === 0) {
    vscode.window.showInformationMessage(
      `Shieldly: Found ${templates.length} stack(s) in ${path.basename(dirPath)} but none contain IAM resources to analyze.`
    );
    return;
  }

  const skipped = templates.length - qualifying.length;
  const apiKey = await getApiKey(context);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Shieldly: Scanning ${qualifying.length} CDK stack(s)…`,
      cancellable: false,
    },
    async (progress) => {
      let worstScore = Infinity;
      let worstResult = null;
      let worstFileName = '';
      let totalFindings = 0;
      let criticals = 0;

      for (let i = 0; i < qualifying.length; i++) {
        const filePath = qualifying[i];
        const fileName = path.basename(filePath);
        progress.report({
          message: `${fileName} (${i + 1}/${qualifying.length})`,
          increment: 100 / qualifying.length,
        });

        // Demo mode gate — check before each API call so we don't hit the server
        // when the local counter is already exhausted.
        if (!apiKey) {
          const demo = checkDemoUsage(context);
          if (!demo.allowed) {
            statusBar.setLimitReached();
            panel.showLimitReached(context, { unitsUsed: 5, cap: 5, demo: true });
            return;
          }
        }

        let policyText;
        try {
          policyText = fs.readFileSync(filePath, 'utf8');
        } catch {
          continue;
        }

        const { reject, reason } = calculateMultiplier('cf', policyText);
        if (reject) {
          vscode.window.showWarningMessage(`Shieldly: ${fileName} too large — ${reason}`);
          continue;
        }

        statusBar.setAnalyzing();
        const result = await analyzeIAM({
          policy: policyText,
          policyType: 'cf',
          apiKey: apiKey ?? undefined,
          apiUrl: getApiUrl(),
        });

        if (!result.success) {
          if (result.limitReached) {
            statusBar.setLimitReached();
            panel.showLimitReached(context, { unitsUsed: 0, cap: 0, demo: !apiKey });
            return;
          }
          vscode.window.showWarningMessage(`Shieldly: ${fileName} — ${result.error}`);
          continue;
        }

        const data = result.result ?? {};

        // Demo mode: consume credit AFTER confirmed success so failures don't burn quota.
        // Skip cache hits (no server quota spent). Prefer server-reported remaining.
        if (!apiKey) {
          const serverLeft = data.demoInfo?.analysesRemaining;
          let usesLeft;
          if (typeof serverLeft === 'number') usesLeft = serverLeft;
          else if (data.cached) usesLeft = getDemoUsesLeft(context);
          else usesLeft = consumeDemoUsage(context);
          panel.showDemoNotice(context, usesLeft);
        }

        const score = data.score ?? 100;
        const findings = data.findings ?? [];
        totalFindings += findings.length;
        criticals += findings.filter((f) => f.severity?.toUpperCase() === 'CRITICAL').length;

        if (score < worstScore) {
          worstScore = score;
          worstResult = data;
          worstFileName = fileName;
        }
      }

      if (worstResult) {
        const riskLevel = worstResult.riskLevel ?? worstResult.overallRisk ?? 'Low';
        lastResult = { ...worstResult, fileName: worstFileName, label: 'CloudFormation Template' };
        statusBar.setScore(worstScore !== Infinity ? String(worstScore) : '—', riskLevel);
        panel.show(context, lastResult);
      } else {
        statusBar.setError();
        return;
      }

      const skipNote = skipped > 0 ? ` (${skipped} stack(s) without IAM skipped)` : '';
      const msg = `Shieldly: ${qualifying.length} stack(s) analyzed · ${totalFindings} finding(s) · ${criticals} critical${skipNote}`;
      if (criticals > 0) {
        vscode.window.showErrorMessage(msg);
      } else {
        vscode.window.showInformationMessage(msg);
      }
    }
  );
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  getApiKeyWithSource(context)
    .then(({ key, source }) => statusBar.setIdle(key, source))
    .catch(() => statusBar.setIdle(null));

  // Command: Analyze current file (also invoked from explorer context menu with a URI)
  context.subscriptions.push(
    vscode.commands.registerCommand('shieldly.analyzeCurrentFile', async (uri) => {
      let doc;
      if (uri instanceof vscode.Uri) {
        try {
          doc = await vscode.workspace.openTextDocument(uri);
        } catch {
          vscode.window.showWarningMessage('Shieldly: Could not open file.');
          return;
        }
      } else {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage(
            'Shieldly: No active editor. Open an IAM policy or CloudFormation file first.'
          );
          return;
        }
        doc = editor.document;
      }
      await analyzeFile(context, doc, true);
    })
  );

  // Command: Set API key
  context.subscriptions.push(
    vscode.commands.registerCommand('shieldly.setApiKey', async () => {
      const key = await promptSetApiKey(context);
      if (key) statusBar.setIdle(key, 'vscode');
    })
  );

  // Command: Clear API key
  context.subscriptions.push(
    vscode.commands.registerCommand('shieldly.clearApiKey', async () => {
      await clearApiKey(context);
      statusBar.setIdle(null);
    })
  );

  // Command: Scan directory for CDK/CF templates (right-click folder in explorer)
  context.subscriptions.push(
    vscode.commands.registerCommand('shieldly.scanDirectory', async (uri) => {
      let dirPath;
      if (uri instanceof vscode.Uri) {
        dirPath = uri.fsPath;
      } else {
        // Invoked from command palette — let user pick a folder
        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: 'Scan for CDK Templates',
        });
        if (!picked || picked.length === 0) return;
        dirPath = picked[0].fsPath;
      }
      await scanDirectory(context, dirPath);
    })
  );

  // Command: Show last result
  context.subscriptions.push(
    vscode.commands.registerCommand('shieldly.showLastResult', () => {
      if (!lastResult) {
        vscode.window.showInformationMessage(
          'Shieldly: No analysis result yet. Run an analysis first.'
        );
        return;
      }
      panel.show(context, lastResult);
    })
  );

  // Auto-analyze runs without explicit user action, so we never let it spend the
  // scarce lifetime demo quota — it requires an API key. Demo users analyze
  // manually (one explicit action at a time) via the command/status bar.
  async function shouldAutoAnalyze(doc) {
    const autoAnalyze = vscode.workspace.getConfiguration().get(AUTO_ANALYZE_SETTING, false);
    if (!autoAnalyze) return false;
    // Ignore non-file documents (git diffs, output panels, settings, etc.) —
    // these fire open events but are not real on-disk policy files.
    if (doc.uri.scheme !== 'file') return false;
    const ext = path.extname(doc.fileName).toLowerCase();
    if (!POLICY_EXTS.has(ext)) return false;
    const apiKey = await getApiKey(context);
    return !!apiKey;
  }

  // Auto-analyze on open
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
      if (await shouldAutoAnalyze(doc)) await analyzeFile(context, doc);
    })
  );

  // Auto-analyze on save (same autoAnalyze setting)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (await shouldAutoAnalyze(doc)) await analyzeFile(context, doc);
    })
  );

  // Clear stale diagnostics when a document is edited (analysis is no longer valid)
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length > 0) {
        diagnostics.clearDiagnostics(event.document.uri);
      }
    })
  );

  // Clear diagnostics when a document is closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics.clearDiagnostics(doc.uri);
    })
  );

  // Cleanup on deactivate
  context.subscriptions.push({
    dispose() {
      statusBar.dispose();
      diagnostics.dispose();
      panel.dispose();
    },
  });
}

function deactivate() {}

module.exports = { activate, deactivate };
