import assert from "node:assert/strict";
import test from "node:test";
import {createJiti} from "jiti";

const jiti = createJiti(import.meta.url);
const {parsePluginCatalog,searchPluginCatalog,pluginLogoUrl,loadPluginLogos} = await jiti.import("./plugin-catalog.ts");
const card = (name="@team/pi-demo", command=`pi install npm:${name}`) => `<article data-package-card="true" data-package-name="${name}" data-package-types="extension skill"><p class="packages-desc">Read &amp; find &lt;code&gt; &#x1f331;</p><div class="packages-meta"><span>Example author</span></div><button data-copy-text="${command}">Copy</button></article>`;
const html = (cards=card(), total=51) => `<span class="packages-count">1-50 / ${total}</span>${cards}<nav class="pagination packages-pagination"><a class="pagination-link" href="/packages?page=2">Next →</a></nav>`;

test("目录只提取文本和明确的 npm 安装来源，分页不丢失", () => {
  const data = parsePluginCatalog(html(card()+card()+card("bad-package","rm -rf anything")),1);
  assert.equal(data.items.length,1);
  assert.equal(data.items[0].source,"npm:@team/pi-demo");
  assert.equal(data.items[0].description,"Read & find <code> 🌱");
  assert.deepEqual(data.items[0].types,["extension","skill"]);
  assert.equal(data.hasNext,true);
  assert.equal(parsePluginCatalog(html(card(),51),2).hasNext,false);
});

test("空结果与目录格式变化分开报告", () => {
  assert.deepEqual(parsePluginCatalog(html("",0),1),{items:[],page:1,total:0,hasNext:false});
  assert.deepEqual(parsePluginCatalog('<span class="packages-count">0 / 5606</span><p class="packages-empty">No packages match this filter.</p>',1),{items:[],page:1,total:0,hasNext:false});
  assert.throws(()=>parsePluginCatalog("<h1>Service unavailable</h1>",1),/format changed/);
  assert.throws(()=>parsePluginCatalog(html("",20),1),/format changed/);
  assert.throws(()=>parsePluginCatalog(html(card("../unsafe"),20),1),/format changed/);
});

test("图标只接受无凭据的 HTTPS 地址", () => {
  assert.equal(pluginLogoUrl("https://cdn.example/logo.png"),"https://cdn.example/logo.png");
  for(const value of ["javascript:alert(1)","file:///secret","data:image/svg+xml,x","http://example/logo","https://user:pass@example/logo",null])assert.equal(pluginLogoUrl(value),undefined);
});

test("目录立即返回文字，图标独立补全并缓存，失败不伪装为空列表", async () => {
  const originalFetch=globalThis.fetch,offline=process.env.PI_OFFLINE;
  const calls=[];
  delete process.env.PI_OFFLINE;
  globalThis.fetch=async url=>{
    calls.push(String(url));
    if(String(url).includes("preview-media"))return Response.json({previews:[{name:"@team/pi-demo",media:{url:"https://cdn.example/logo.png"}}]});
    return new Response(html());
  };
  try {
    const result=await searchPluginCatalog("unit & 安装",1);
    assert.equal(new URL(calls[0]).searchParams.get("name"),"unit & 安装");
    assert.equal(result.items[0].logo,undefined);
    assert.equal(calls.length,1,"文字目录不等待图标接口");
    assert.deepEqual(await loadPluginLogos(["@team/pi-demo"]),{"@team/pi-demo":"https://cdn.example/logo.png"});
    await loadPluginLogos(["@team/pi-demo"]);
    await searchPluginCatalog("unit & 安装",1);
    assert.equal(calls.length,2);
    globalThis.fetch=async()=>new Response("upstream error",{status:503});
    await assert.rejects(searchPluginCatalog("uncached failure",1),/HTTP 503/);
    process.env.PI_OFFLINE="1";
    await assert.rejects(searchPluginCatalog("offline uncached",1),/offline/);
  } finally {
    globalThis.fetch=originalFetch;
    if(offline===undefined)delete process.env.PI_OFFLINE;else process.env.PI_OFFLINE=offline;
  }
});
