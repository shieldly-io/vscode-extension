// CJS copy of apps/web/src/lib/multiplier.js — canonical source is the web app.
// Keep in sync manually when multiplier rules change.

/**
 * @param {'iam' | 'cf' | 'cost'} inputType
 * @param {string | number} rawInput
 * @returns {{ multiplier: number, reject: boolean, reason?: string }}
 */
function calculateMultiplier(inputType, rawInput) {
  if (inputType === 'iam') {
    const chars = typeof rawInput === 'string' ? rawInput.length : rawInput;
    if (chars > 25000)
      return { multiplier: 0, reject: true, reason: 'split into smaller policies' };
    if (chars > 12000) return { multiplier: 8, reject: false };
    if (chars > 6000) return { multiplier: 5, reject: false };
    if (chars > 3000) return { multiplier: 3, reject: false };
    if (chars > 1200) return { multiplier: 2, reject: false };
    return { multiplier: 1, reject: false };
  }
  if (inputType === 'cf') {
    const bytes = typeof rawInput === 'number' ? rawInput : rawInput.length;
    const kb = bytes / 1024;
    if (kb > 600) return { multiplier: 0, reject: true, reason: 'split your CDK stacks' };
    if (kb > 300) return { multiplier: 30, reject: false };
    if (kb > 100) return { multiplier: 20, reject: false };
    if (kb > 25) return { multiplier: 10, reject: false };
    return { multiplier: 5, reject: false };
  }
  if (inputType === 'cost') {
    const chars = typeof rawInput === 'string' ? rawInput.length : rawInput;
    if (chars > 20000) return { multiplier: 0, reject: true, reason: 'reduce input size' };
    if (chars > 8000) return { multiplier: 3, reject: false };
    if (chars > 3000) return { multiplier: 2, reject: false };
    return { multiplier: 1, reject: false };
  }
  return { multiplier: 1, reject: false };
}

function formatPaygCost(multiplier) {
  return `$${(multiplier * 0.09).toFixed(2)}`;
}

module.exports = { calculateMultiplier, formatPaygCost };
