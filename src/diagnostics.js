// @ts-check
const vscode = require('vscode');

/** @type {vscode.DiagnosticCollection} */
let diagnosticCollection;

function getCollection() {
  if (!diagnosticCollection) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('shieldly');
  }
  return diagnosticCollection;
}

const SEVERITY_MAP = {
  Critical: vscode.DiagnosticSeverity.Error,
  High: vscode.DiagnosticSeverity.Warning,
  Medium: vscode.DiagnosticSeverity.Information,
  Low: vscode.DiagnosticSeverity.Hint,
};

/**
 * Try to find the line in the document that best matches a finding's resource/action.
 * Falls back to line 0 if nothing found.
 * @param {vscode.TextDocument} doc
 * @param {string} resource
 * @returns {vscode.Range}
 */
function findRange(doc, resource) {
  if (resource) {
    const text = doc.getText();
    // Search for the resource value as a string in the document
    const searchTerms = [resource.replace(/^Resource:\s*/, '').trim(), resource];
    for (const term of searchTerms) {
      if (!term || term === '*') continue;
      const idx = text.indexOf(term);
      if (idx !== -1) {
        const pos = doc.positionAt(idx);
        return new vscode.Range(pos, pos.translate(0, term.length));
      }
    }
  }
  // Fallback: highlight first non-empty line
  for (let i = 0; i < Math.min(doc.lineCount, 5); i++) {
    const line = doc.lineAt(i);
    if (!line.isEmptyOrWhitespace) {
      return line.range;
    }
  }
  return new vscode.Range(0, 0, 0, 0);
}

/**
 * Publish diagnostics for a document based on analysis findings.
 * @param {vscode.TextDocument} doc
 * @param {Array<{severity: string, title: string, description: string, resource: string, remediation: string}>} findings
 */
function publishDiagnostics(doc, findings) {
  const collection = getCollection();
  const diagnostics = (findings || []).map((finding) => {
    const severity = SEVERITY_MAP[finding.severity] ?? vscode.DiagnosticSeverity.Information;
    const range = findRange(doc, finding.resource);
    const diag = new vscode.Diagnostic(range, `[${finding.severity}] ${finding.title}`, severity);
    diag.source = 'Shieldly AI';
    diag.code = {
      value: 'shieldly',
      target: vscode.Uri.parse('https://www.shieldly.io/docs/api'),
    };
    // Attach remediation as related info
    if (finding.remediation) {
      diag.relatedInformation = [
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(doc.uri, range),
          `Remediation: ${finding.remediation}`
        ),
      ];
    }
    return diag;
  });
  collection.set(doc.uri, diagnostics);
}

function clearDiagnostics(uri) {
  getCollection().delete(uri);
}

function clearAll() {
  getCollection().clear();
}

function dispose() {
  diagnosticCollection?.dispose();
  diagnosticCollection = undefined;
}

module.exports = { publishDiagnostics, clearDiagnostics, clearAll, dispose };
