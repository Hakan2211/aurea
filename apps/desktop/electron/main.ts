import { app, BrowserWindow, ipcMain, nativeTheme, shell, utilityProcess } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { probeStudiod, readPortFile } from "@aurea/core/portfile";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// dist-electron/ sits next to dist/ (the built renderer)
const DIST = path.join(__dirname, "../dist");
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

const INK = "#0a0a0b";
const CREAM = "#edeae4";

let win: BrowserWindow | null = null;

/* ---------- studiod (tier 3: core service over localhost tRPC) ---------- */

interface StudiodInfo {
  port: number;
  token: string;
}

let studiod: StudiodInfo | null = null;
let studiodChild: Electron.UtilityProcess | null = null;

/** Reuse a live studiod (headless CLI may own the GPU already); fork otherwise. */
async function ensureStudiod(): Promise<void> {
  const existing = await readPortFile();
  if (existing && (await probeStudiod(existing))) {
    studiod = { port: existing.port, token: existing.token };
    return;
  }

  const child = utilityProcess.fork(path.join(__dirname, "studiod.js"), [], {
    serviceName: "aurea-studiod",
  });
  studiodChild = child;

  studiod = await new Promise<StudiodInfo | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 15_000);
    child.once("message", (msg: StudiodInfo) => {
      clearTimeout(timeout);
      resolve(msg);
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });

  if (!studiod) console.error("studiod failed to start — renderer will run on fallback data");
}

ipcMain.handle("aurea:studiod", () => studiod);

function createWindow() {
  win = new BrowserWindow({
    title: "Aurea",
    width: 1520,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: INK,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: INK,
      symbolColor: CREAM,
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // Avoid a white flash, then present the window fully painted
  win.once("ready-to-show", () => win?.show());

  // External links open in the system browser, never inside the shell
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (DEV_SERVER_URL) {
    win.loadURL(DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(DIST, "index.html"));
  }

  win.on("closed", () => {
    win = null;
  });
}

nativeTheme.themeSource = "dark";

app.whenReady().then(async () => {
  // core first: the renderer asks for {port, token} as soon as it boots
  await ensureStudiod();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("quit", () => {
  studiodChild?.kill();
});
