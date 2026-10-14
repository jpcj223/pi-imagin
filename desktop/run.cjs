/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const { spawn } = require("node:child_process");
const electron = require("electron");
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
if (process.argv.includes("--dev")) environment.PI_IMAGIN_DESKTOP_DEV_URL = "http://127.0.0.1:30141";
const child = spawn(electron, [path.resolve(__dirname)], { windowsHide: true, stdio: "inherit", env: environment });
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
