import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { defaultCwdPath, localDateStamp } =
  await createJiti(import.meta.url).import("./default-cwd.ts");

test("stamps the local calendar date, not the UTC one", () => {
  // 00:30 local time on Jan 2 — still Jan 1 in UTC for any zone east of UTC.
  const justAfterMidnight = new Date(2026, 0, 2, 0, 30);
  assert.equal(localDateStamp(justAfterMidnight), "20260102");
  // 23:30 local time on Dec 31 — already Jan 1 in UTC for any zone west of UTC.
  assert.equal(localDateStamp(new Date(2025, 11, 31, 23, 30)), "20251231");
});

test("places the dated folder under ~/pi-cwd", () => {
  const home = path.join(os.tmpdir(), "pi-imagin-home");
  assert.equal(
    defaultCwdPath(new Date(2026, 8, 29, 7), home),
    path.join(home, "pi-cwd", "20260929"),
  );
});

test("桌面开发默认目录单独隔离，普通模式不采用开发目录",t=>{
 const previous={flag:process.env.PI_IMAGIN_DESKTOP_DEV,workspace:process.env.PI_IMAGIN_DESKTOP_DEV_WORKSPACE};
 t.after(()=>{for(const [key,value] of [["PI_IMAGIN_DESKTOP_DEV",previous.flag],["PI_IMAGIN_DESKTOP_DEV_WORKSPACE",previous.workspace]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 const home=path.join(os.tmpdir(),"normal-home"),development=path.join(os.tmpdir(),"desktop-isolated");
 process.env.PI_IMAGIN_DESKTOP_DEV="1";process.env.PI_IMAGIN_DESKTOP_DEV_WORKSPACE=development;
 assert.equal(defaultCwdPath(new Date(2026,9,17),home),path.join(development,"20261017"));
 delete process.env.PI_IMAGIN_DESKTOP_DEV;
 assert.equal(defaultCwdPath(new Date(2026,9,17),home),path.join(home,"pi-cwd","20261017"));
});
