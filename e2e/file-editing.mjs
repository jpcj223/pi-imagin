import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

/** 用真实文件接口验证两端编辑；磁盘读写回调仅操作调用方提供的隔离夹具。 */
export async function checkFileEditing(page, client, artifacts, fixture) {
  page.setDefaultTimeout(15000);
  const { origin, first, second, readonly, large, readDisk, writeDisk } = fixture;
  const results = [];
  const passed = name => { results.push(name); writeFileSync(join(artifacts,`file-editing-${client}.json`),JSON.stringify({client,passed:results},null,2)); console.log(`PASS ${client}: ${name}`); };
  await page.goto(`${origin}/?session=home-return-test`, { waitUntil: "domcontentloaded" });
  await page.locator('.workspace-shell[data-startup-ready="true"]').waitFor();
  const rail = page.getByRole('navigation', { name: '全局导航', exact: true });
  const browse = async () => {
    const back = page.locator('.workspace-files-back');
    if (await back.isVisible()) return;
    const group = page.locator('.session-tree-group.is-current').first();
    await group.hover(); await group.locator('.session-tree-group-action').click();
    await page.getByRole('menuitem', { name: /浏览.*文件/ }).click();
  };
  const open = async file => { await browse(); await page.getByTitle(file.replaceAll('\\','/'), { exact: true }).click(); };
  const editor = file => page.getByRole('textbox', { name: `文件编辑器 ${file.split(/[\\/]/).at(-1)}`, exact: true });
  const label = file => page.getByRole('tab', { name: file.split(/[\\/]/).at(-1), exact: true });
  const save = async file => {
    const response = page.waitForResponse(response => response.url().endsWith('/api/file-edit') && response.request().postDataJSON()?.action === 'save');
    await editor(file).press('Control+s'); assert.equal((await response).status(),200);
    await page.waitForFunction(() => document.querySelector('.file-editor-save')?.disabled === true);
  };
  if (!fixture.onlyTail) {
  await open(first); await editor(first).waitFor();
  assert.ok(await page.locator('.file-code-keyword').count());
  await editor(first).fill('<template>\n  <div>未保存内容</div>\n</template>\n');
  await open(second); await editor(second).waitFor(); await label(first).click();
  assert.match(await editor(first).inputValue(), /未保存内容/); assert.ok(await label(first).locator('.is-dirty').count());
  await page.locator('.file-panel-expand-button').click(); await rail.getByRole('button',{name:'主页',exact:true}).click();
  assert.match(await editor(first).inputValue(), /未保存内容/);
  passed('直接编辑、通用高亮、标签切换与主页返回保留修改');
  await save(first); const bytes = readDisk(first);
  assert.deepEqual([...bytes.subarray(0,3)],[239,187,191]); assert.ok(bytes.toString('utf8').includes('\r\n')); assert.equal(bytes.toString('utf8').replaceAll('\r\n','').includes('\n'),false);
  passed('Ctrl+S 真实保存并保留 BOM 和 CRLF');
  await editor(first).press('Control+End'); await page.keyboard.type('undo-check');
  await editor(first).press('Control+z'); assert.equal((await editor(first).inputValue()).endsWith('undo-check'),false);
  await editor(first).press('Control+y'); assert.equal((await editor(first).inputValue()).endsWith('undo-check'),true);
  passed('原生撤销与重做');
  await label(first).getByRole('button').click(); const close = page.getByRole('dialog',{name:'保存文件修改？',exact:true});
  await close.getByRole('button',{name:'取消',exact:true}).click(); assert.ok(await editor(first).isVisible());
  await label(first).getByRole('button').click(); await close.getByRole('button',{name:'保存并关闭',exact:true}).click(); await label(first).waitFor({state:'hidden'});
  assert.ok(readDisk(first).toString('utf8').endsWith('undo-check'));
  await open(first); await editor(first).fill('discard-this'); await label(first).getByRole('button').click(); await close.getByRole('button',{name:'放弃修改',exact:true}).click(); await label(first).waitFor({state:'hidden'});
  assert.ok(readDisk(first).toString('utf8').endsWith('undo-check'));
  passed('关闭时取消、保存并关闭、放弃均按预期执行');
  await open(first); await editor(first).fill('keep-after-failure');
  await page.route('**/api/file-edit',route=>route.request().postDataJSON()?.action==='save'?route.fulfill({status:500,json:{error:'隔离测试保存失败'}}):route.continue());
  await editor(first).press('Control+s'); await page.getByRole('alert').getByText('隔离测试保存失败',{exact:true}).waitFor();
  assert.equal(await editor(first).inputValue(),'keep-after-failure'); await page.unroute('**/api/file-edit');
  passed('保存失败保留内容与未保存标记');
  writeDisk(first, Buffer.from('\ufeff磁盘外部修改\r\n','utf8'));
  await editor(first).press('Control+s'); await page.getByRole('button',{name:'比较磁盘版本',exact:true}).waitFor();
  assert.equal(await editor(first).inputValue(),'keep-after-failure'); assert.ok(readDisk(first).toString('utf8').includes('磁盘外部修改'));
  await page.getByRole('button',{name:'比较磁盘版本',exact:true}).click(); await page.locator('.file-edit-comparison').getByText('磁盘外部修改',{exact:true}).waitFor();
  await editor(first).fill('磁盘外部修改\n手动合并的内容\n');
  page.once('dialog',dialog=>dialog.accept()); await page.getByRole('button',{name:'保存当前合并内容',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('.file-editor-save')?.disabled === true);
  assert.ok(readDisk(first).toString('utf8').includes('手动合并的内容'));
  passed('外部变化拒绝覆盖，比较并明确确认后保存合并内容');
  await open(readonly); await page.getByText('只读或具有硬链接的文件仅支持查看。',{exact:true}).waitFor(); assert.equal(await editor(readonly).count(),0);
  await open(large); await page.getByText('文件超过 1 MiB，使用只读查看以保持流畅。',{exact:true}).waitFor(); assert.equal(await editor(large).count(),0);
  passed('只读及大文件降级，原有查看器保留');
  await label(first).click(); await editor(first).fill('刷新后保留的修改');
  page.once('dialog',dialog=>void dialog.accept().catch(error=>console.error('刷新对话框操作失败',error.message))); await page.reload({waitUntil:'domcontentloaded'}); await page.locator('.workspace-shell[data-startup-ready="true"]').waitFor();
  await open(first); await editor(first).waitFor(); assert.equal(await editor(first).inputValue(),'刷新后保留的修改');
  passed('刷新离开提醒及本标签草稿恢复');
  // 结束前明确放弃隔离草稿，避免自动清理窗口时留下原生确认框。
  await label(first).getByRole('button').click(); await close.getByRole('button',{name:'放弃修改',exact:true}).click();
  }
  if (!fixture.onlyMobile) {
  await open(first); await editor(first).fill('保护未保存文件');
  await page.getByRole('button',{name:'sample.vue的操作',exact:true}).click();
  const actions=page.getByRole('dialog',{name:'sample.vue的操作',exact:true});
  await actions.getByRole('button',{name:'重命名',exact:true}).click();await actions.getByRole('textbox').fill('renamed.vue');await actions.getByRole('button',{name:'保存',exact:true}).click();
  await actions.getByText('该文件或目录中有未保存修改，请先保存或关闭对应文件。',{exact:true}).waitFor();
  assert.ok(readDisk(first));await actions.getByRole('button',{name:'取消',exact:true}).click();
  await label(first).getByRole('button').click();await page.getByRole('dialog',{name:'保存文件修改？',exact:true}).getByRole('button',{name:'放弃修改',exact:true}).click();
  passed('未保存文件阻止重命名，避免草稿随路径变更丢失');
  }
  await open(second); await editor(second).waitFor();
  if(client==='web') {
    if (!fixture.onlyMobile) await page.screenshot({path:join(artifacts,'file-editor-web.png')});
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'显示右侧栏',exact:true}).click();
    await page.locator('#file-panel .workspace-file-tab-strip').waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const box=await page.locator('#file-panel .workspace-file-tab-strip').boundingBox();assert.ok(box.width<=390);
    await page.screenshot({path:join(artifacts,'file-editor-mobile.png')});
    passed('窄屏标签滚动区域不造成页面横向溢出');
  }
  return {client,passed:results};
}
