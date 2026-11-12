const vscode = require("vscode");

// SQL is outside the official extension's activation events. Once activated,
// the fork registers SQL through that extension's existing LSP connection.
async function activate() {
  await vscode.extensions.getExtension("oxc.oxc-vscode").activate();
}

module.exports = { activate };
