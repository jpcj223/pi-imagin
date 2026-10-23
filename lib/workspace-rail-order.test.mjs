import assert from "node:assert/strict";
import test from "node:test";
import {createJiti} from "jiti";
const {normalizeRailOrder,moveRailItem}=await createJiti(import.meta.url).import("./workspace-rail-order.ts");
test("导航顺序兼容缺项、重复项、未知项和损坏存储",()=>{
  assert.deepEqual(normalizeRailOrder(null),["home","search","plugins"]);
  assert.deepEqual(normalizeRailOrder(["plugins","plugins","unknown"]),["plugins","home","search"]);
});
test("调整单个入口位置，不改变其他入口且不修改原数组",()=>{
  const order=["home","search","plugins"];
  assert.deepEqual(moveRailItem(order,"plugins","home"),["plugins","home","search"]);
  assert.deepEqual(order,["home","search","plugins"]);
  assert.deepEqual(moveRailItem(order,"home","plugins"),["search","plugins","home"]);
});
