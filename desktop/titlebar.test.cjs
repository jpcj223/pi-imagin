/* eslint-disable @typescript-eslint/no-require-imports */
const test=require("node:test"),assert=require("node:assert/strict");
const {titlebarOptions}=require("./titlebar.cjs");
test("标题栏只接收颜色和尺寸，缩放后与网页高度一致",()=>{
  const style={color:"#242424",symbolColor:"#eeeeee",height:36,other:"ignored"};
  assert.deepEqual(titlebarOptions(style),{color:"#242424",symbolColor:"#eeeeee",height:35});
  assert.equal(titlebarOptions(style,1.25).height,44);
  assert.equal(titlebarOptions(style,0.8).height,28);
  for(const invalid of [{...style,color:"url(file:///secret)"},{...style,height:Infinity},{...style,height:500},null])assert.equal(titlebarOptions(invalid),null);
  assert.ok(require("./package.json").build.files.includes("titlebar.cjs"),"正式打包需要包含主进程引用的标题栏模块");
});
