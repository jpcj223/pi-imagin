/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createStartupView } = require("./startup-view.cjs");

function setup() {
  const views = [];
  class FakeView {
    constructor() {
      views.push(this);
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: {}, destroyed:false, sent:[],
        loadFile:async () => {}, setWindowOpenHandler() {},
        send(...args) { this.sent.push(args); },
        isDestroyed() { return this.destroyed; }, close() { this.destroyed = true; },
      });
    }
    setBounds(bounds) { this.bounds = bounds; }
    setBackgroundColor() {}
  }
  const children = [];
  const window = Object.assign(new EventEmitter(), {
    visible:false, isDestroyed:() => false,
    getContentBounds:() => ({ width:900, height:600 }),
    show() { this.visible = true; },
    contentView: { addChildView(view) { children.push(view); }, removeChildView(view) { children.splice(children.indexOf(view),1); } },
  });
  const startup = createStartupView({ WebContentsView:FakeView, window, isQuitting:() => false, canShow:() => false });
  return { startup, views, window, children };
}
test("过渡仅在首屏就绪后结束，拒绝其他框架的回执并释放视图和监听", async () => {
  const { startup, views, window, children } = setup();
  await startup.show();
  const view = views[0];
  assert.deepEqual(view.bounds, { x:0,y:0,width:900,height:600 });
  assert.equal(window.visible, false);
  view.webContents.emit("ipc-message", { senderFrame:view.webContents.mainFrame }, "pi-imagin:startup-transition-finished");
  assert.equal(children.length,1);
  startup.finish();
  view.webContents.emit("ipc-message", { senderFrame:{} }, "pi-imagin:startup-transition-finished");
  assert.equal(children.length,1);
  view.webContents.emit("ipc-message", { senderFrame:view.webContents.mainFrame }, "pi-imagin:startup-transition-finished");
  assert.equal(children.length,0);
  assert.equal(view.webContents.destroyed,true);
  assert.equal(window.listenerCount("resize"),0);
});
test("重试替换旧视图，退出可重复清理，没有动画回执也会自动释放", async () => {
  const { startup, views, children } = setup();
  await startup.show(); await startup.show();
  assert.equal(views[0].webContents.destroyed,true);
  assert.equal(children.length,1);
  startup.finish();
  await new Promise(resolve => setTimeout(resolve,320));
  assert.equal(children.length,0);
  startup.dispose(); startup.dispose();
});
