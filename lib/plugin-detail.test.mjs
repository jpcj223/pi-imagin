import assert from "node:assert/strict";
import test from "node:test";
import {createJiti} from "jiti";
const {parsePluginDetail,loadPluginDetail,isCatalogPackageName,pluginWebLink}=await createJiti(import.meta.url).import("./plugin-detail.ts");
const html=`<dl class="definition-grid detail-grid"><dt>Package</dt><dd><code>@demo/plugin</code></dd><dt>Version</dt><dd>1.2.3</dd><dt>Author</dt><dd>A &amp; B</dd><dt>Dependencies</dt><dd>2 dependencies</dd></dl><section><div class="content-card-body"><div class="rich-text packages-readme"><h2>Usage</h2><p>Real documentation &amp; examples</p></div></div></section>`;
test("详情解析保留说明及来源字段，拒绝错误身份与格式",()=>{
  const parsed=parsePluginDetail(html,"@demo/plugin");
  assert.equal(parsed.version,"1.2.3");assert.equal(parsed.author,"A & B");
  assert.match(parsed.readmeHtml,/<h2>Usage<\/h2>/);
  assert.equal(parsed.description,undefined);
  assert.equal(parsePluginDetail(html.replace("Real documentation &amp; examples","x".repeat(500001)),"@demo/plugin").readmeTruncated,true);
  assert.throws(()=>parsePluginDetail(html,"wrong-name"),/identity/);
  assert.throws(()=>parsePluginDetail("error","@demo/plugin"),/format/);
});
test("仅允许公开包名及网页链接",()=>{
  for(const name of ["@team/name","plain-package"])assert.equal(isCatalogPackageName(name),true);
  for(const name of ["../secret","https://example/pkg","name?query=1",null])assert.equal(isCatalogPackageName(name),false);
  assert.equal(pluginWebLink("git+https://github.com/team/repo"),"https://github.com/team/repo");
  for(const url of ["file:///C:/private","javascript:alert(1)","https://user:pass@example.com/"])assert.equal(pluginWebLink(url),undefined);
});
test("元数据补足完整描述、保留官方版本并缓存，部分失败保留可用信息",async()=>{
  const original=globalThis.fetch,offline=process.env.PI_OFFLINE,calls=[];
  delete process.env.PI_OFFLINE;
  globalThis.fetch=async url=>{
    calls.push(String(url));
    if(String(url).includes("registry.npmjs.org"))return Response.json({name:"@demo/plugin",version:"2.0.0",description:"Full source description",repository:{url:"git+https://github.com/demo/repo.git"},engines:{node:">=22"}});
    return new Response(html);
  };
  try{
    const detail=await loadPluginDetail("@demo/plugin");
    assert.equal(detail.description,"Full source description");assert.equal(detail.version,"1.2.3");assert.equal(detail.engines.node,">=22");assert.equal(detail.repository,"https://github.com/demo/repo");
    await loadPluginDetail("@demo/plugin");assert.equal(calls.length,2);
    globalThis.fetch=async url=>String(url).includes("pi.dev")?new Response("offline",{status:503}):Response.json({name:"partial-plugin",description:"Available metadata",version:"1"});
    const partial=await loadPluginDetail("partial-plugin");assert.equal(partial.partial,true);assert.equal(partial.description,"Available metadata");
    process.env.PI_OFFLINE="1";await assert.rejects(loadPluginDetail("uncached-plugin"),/offline/);
  }finally{globalThis.fetch=original;if(offline===undefined)delete process.env.PI_OFFLINE;else process.env.PI_OFFLINE=offline;}
});
