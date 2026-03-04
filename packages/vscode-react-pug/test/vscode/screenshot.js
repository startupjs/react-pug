const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const vscode = require('vscode');

const captureEnabled = /^(1|true|yes)$/i.test(process.env.VSCODE_CAPTURE_SCREENSHOTS || '');
const strictCapture = /^(1|true|yes)$/i.test(process.env.VSCODE_CAPTURE_SCREENSHOTS_STRICT || '');
const configuredSettleMs = Number.parseInt(process.env.VSCODE_SCREENSHOT_SETTLE_MS || '', 10);
const screenshotSettleMs = Number.isFinite(configuredSettleMs) && configuredSettleMs >= 0
  ? configuredSettleMs
  : 1500;

let screenshotCounter = 0;
let screenshotsInitialized = false;

function sanitizeName(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'step';
}

function screenshotDir() {
  if (process.env.VSCODE_TEST_SCREENSHOT_DIR) {
    return process.env.VSCODE_TEST_SCREENSHOT_DIR;
  }
  const workspace = sanitizeName(process.env.TEST_WORKSPACE_NAME || 'workspace');
  return path.join(process.cwd(), 'artifacts', 'vscode-screenshots', workspace);
}

function toRange(range) {
  return {
    start: { line: range.start.line + 1, character: range.start.character + 1 },
    end: { line: range.end.line + 1, character: range.end.character + 1 },
  };
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const cp = spawn(command, args, { stdio: 'ignore' });
    cp.once('error', reject);
    cp.once('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function captureDesktopPng(filePath) {
  if (process.platform === 'darwin') {
    await runCommand('screencapture', ['-x', '-t', 'png', filePath]);
    return true;
  }

  if (process.platform === 'linux') {
    const linuxCandidates = [
      ['import', ['-window', 'root', filePath]],
      ['gnome-screenshot', ['-f', filePath]],
      ['scrot', [filePath]],
    ];
    for (const [command, args] of linuxCandidates) {
      try {
        await runCommand(command, args);
        return true;
      } catch {
        // Try next available screenshot command.
      }
    }
    return false;
  }

  if (process.platform === 'win32') {
    const escapedPath = filePath.replace(/\\/g, '\\\\').replace(/'/g, "''");
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type -AssemblyName System.Drawing',
      '$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
      '$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)',
      '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
      '$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)',
      `$bitmap.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      '$graphics.Dispose()',
      '$bitmap.Dispose()',
    ].join('; ');
    await runCommand('powershell', ['-NoProfile', '-Command', script]);
    return true;
  }

  return false;
}

async function captureViaVsCodeCommand(filePath) {
  try {
    const result = await vscode.commands.executeCommand('screenshot-focused-window');
    const imageData = result?.buffer ?? result?.value ?? result;
    if (!imageData) return false;
    const buffer = Buffer.isBuffer(imageData) ? imageData : Buffer.from(imageData);
    if (!buffer.length) return false;
    await fs.writeFile(filePath, buffer);
    return true;
  } catch {
    return false;
  }
}

async function collectEditorState(extra) {
  const activeEditor = vscode.window.activeTextEditor;
  const workspaceFolders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
  const visibleEditors = vscode.window.visibleTextEditors.map((editor) => ({
    uri: editor.document.uri.toString(),
    languageId: editor.document.languageId,
  }));

  let active = null;
  let diagnostics = [];
  if (activeEditor) {
    const doc = activeEditor.document;
    active = {
      uri: doc.uri.toString(),
      fsPath: doc.uri.fsPath,
      languageId: doc.languageId,
      selection: toRange(activeEditor.selection),
      visibleRanges: activeEditor.visibleRanges.map(toRange),
      lineCount: doc.lineCount,
    };
    diagnostics = vscode.languages.getDiagnostics(doc.uri).map((d) => ({
      message: d.message,
      severity: d.severity,
      code: d.code ?? null,
      range: toRange(d.range),
    }));
  }

  return {
    capturedAt: new Date().toISOString(),
    workspaceName: process.env.TEST_WORKSPACE_NAME || null,
    workspaceFolders,
    activeEditor: active,
    visibleEditors,
    diagnostics,
    extra: extra || null,
  };
}

function resetScreenshotCounter() {
  screenshotCounter = 0;
}

async function captureTestStep(stepName, extra) {
  if (!captureEnabled) return null;

  screenshotCounter += 1;
  const baseName = `${String(screenshotCounter).padStart(3, '0')}-${sanitizeName(stepName)}`;
  const outDir = screenshotDir();
  const pngPath = path.join(outDir, `${baseName}.png`);
  const jsonPath = path.join(outDir, `${baseName}.json`);

  if (!screenshotsInitialized) {
    await fs.rm(outDir, { recursive: true, force: true });
    screenshotsInitialized = true;
  }
  await fs.mkdir(outDir, { recursive: true });
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  await new Promise((resolve) => setTimeout(resolve, screenshotSettleMs));

  const state = await collectEditorState(extra);
  let screenshotError = null;
  let screenshotPath = null;

  try {
    const captured = await captureViaVsCodeCommand(pngPath) || await captureDesktopPng(pngPath);
    if (captured) screenshotPath = pngPath;
    if (!captured) screenshotError = `No screenshot strategy succeeded on platform ${process.platform}`;
  } catch (err) {
    screenshotError = err instanceof Error ? err.message : String(err);
    if (strictCapture) throw err;
  }

  await fs.writeFile(jsonPath, JSON.stringify({
    ...state,
    screenshotSettleMs,
    screenshotFile: screenshotPath ? path.basename(screenshotPath) : null,
    screenshotError,
  }, null, 2), 'utf8');

  return { screenshotPath, statePath: jsonPath };
}

module.exports = {
  captureTestStep,
  isScreenshotCaptureEnabled: captureEnabled,
  resetScreenshotCounter,
};
