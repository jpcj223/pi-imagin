/** 在隔离的历史视图中适配 SDK 导出样式；记录、搜索、筛选及导出脚本保持原样。 */
export function sessionHistoryDocument(html: string, dark: boolean, baseUrl?: string): string {
  if (!/<\/head>/i.test(html)) throw new Error("历史页面格式不完整");
  const bg = dark ? "#171b20" : "#ffffff";
  const panel = dark ? "#20262d" : "#f7f8f9";
  const text = dark ? "#dce3e9" : "#25323b";
  const muted = dark ? "#99a5b1" : "#77818c";
  const border = dark ? "#343e48" : "#e7ebee";
  const accent = dark ? "#72b9da" : "#165e82";
  const selected = dark ? "#283b48" : "#e7eef3";
  const style = `<style id="workspace-history-style">
    :root{color-scheme:${dark ? "dark" : "light"};--body-bg:${bg};--container-bg:${bg};--info-bg:${panel};--text:${text};--dim:${muted};--muted:${muted};--border:${border};--accent:${accent};--borderAccent:${accent};--selectedBg:${selected};--hover:${panel};--thinkingText:${muted};--userMessageBg:${panel};--userMessageText:${text};--toolPendingBg:${panel};--toolSuccessBg:${panel};--toolErrorBg:${dark ? "#39262b" : "#fff3f3"};--toolTitle:${accent};--toolOutput:${text};--mdHeading:${text};--mdText:${text};--mdLink:${accent};--mdListBullet:${accent};--mdHr:${border};--mdQuoteBorder:${border};--mdQuote:${muted};--customMessageBg:${panel};--customMessageText:${text};--customMessageLabel:${accent};--line-height:22px;}
    html,body{height:100%;overflow:hidden;}body{font:14px/1.8 system-ui,-apple-system,"Segoe UI",sans-serif;}
    #app{position:relative;display:grid;grid-template: auto minmax(0,1fr) / minmax(0,1fr);height:100dvh;min-height:0;overflow:hidden;}
    #sidebar,#sidebar.open{position:absolute;inset:var(--history-toolbar-height,84px) auto 0 0;transform:none;width:min(320px,calc(100% - 44px))!important;min-width:0;max-width:none;height:auto;border:0;border-right:1px solid var(--border);background:${panel};z-index:11;box-shadow:8px 0 24px #00000018;}
    #hamburger,#sidebar-overlay,#sidebar-resizer,.sidebar-close{display:none!important;}
    .sidebar-header{grid-area:1 / 1 / 2 / -1;display:flex;align-items:center;flex-wrap:wrap;gap:8px 14px;padding:10px 14px;border-bottom:1px solid var(--border);background:${bg};min-width:0;z-index:12;}.sidebar-controls{display:flex;align-items:center;gap:8px;padding:0;flex:1 1 250px;max-width:360px;min-width:0;}.sidebar-filters{padding:0;gap:5px;margin:0;}
    .sidebar-search{flex:1;min-width:0;width:0;height:32px;font:12px/1.6 system-ui;padding:6px 10px;border:1px solid var(--border);border-radius:6px;}
    .filter-btn{font:11px/1.5 system-ui;padding:4px 7px;border:1px solid var(--border);border-radius:5px;color:var(--dim);}
    .filter-btn.active{background:var(--selectedBg);color:var(--accent);border-color:var(--border);}
    .tree-container{min-height:0;overflow:auto;padding:0 10px 8px;scrollbar-gutter:stable;}.tree-status{font:11px/1.5 system-ui;padding:6px 14px;color:var(--dim);border-top:1px solid var(--border);}
    .tree-node{font:12px/20px system-ui;min-height:30px;padding:5px 7px;border-radius:5px;align-items:center;box-sizing:border-box;margin:1px 0;gap:2px;}
    .tree-node.in-path{background:transparent;}.tree-node:not(.in-path){opacity:.7;}.tree-node.active,.tree-node:hover{background:var(--selectedBg);opacity:1;}.tree-node.active{box-shadow:inset 2px 0 var(--accent);}.tree-node.active .tree-content{font-weight:500;}
    .tree-prefix{font-size:11px;opacity:.6;}.tree-content{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;}.tree-role-assistant{color:var(--accent);}
    #content{grid-area:2 / 1;min-height:0;min-width:0;overflow:auto;padding:20px 18px 32px;align-items:stretch;scrollbar-gutter:stable;overflow-anchor:none;overscroll-behavior:contain;}
    #content>*{width:100%;max-width:860px;min-width:0;flex-shrink:0;margin-inline:auto;}.header{padding:14px;background:${panel};border:1px solid var(--border);border-radius:9px;margin-bottom:24px;overflow-wrap:anywhere;}
    .header h1{font:400 11px/1.7 system-ui;margin:0 0 8px;color:var(--dim);overflow-wrap:anywhere;}.help-bar{gap:8px;margin-bottom:8px;}.help-hint{display:none;}.help-actions{gap:6px;}
    .header-toggle-btn,.download-json-btn{font:12px/1.5 system-ui;padding:5px 9px;border-radius:6px;min-height:30px;}.header-toggle-btn[aria-pressed="true"]{font-weight:500;background:var(--selectedBg);border-color:var(--border);}
    .info-item{display:grid;grid-template-columns:64px minmax(0,1fr);font:12px/1.8 system-ui;gap:8px;}.info-label{min-width:0;margin:0;font-weight:400;color:var(--dim);}.info-value{overflow-wrap:anywhere;}
    #messages{gap:22px;}.user-message{padding:12px 16px;border-radius:8px;border:1px solid var(--border);}.assistant-message{padding:0;}.assistant-message>.message-timestamp{padding-left:0;}.message-timestamp{font:11px/1.7 system-ui;opacity:1;margin-bottom:6px;}
    .assistant-text{padding:0;line-height:1.85;}.thinking-text{font:12px/1.8 system-ui;padding:10px 12px;margin-bottom:12px;background:${panel};border-left:2px solid var(--border);border-radius:0 6px 6px 0;}.thinking-collapsed{font:12px/1.7 system-ui;padding:4px 0;}
    .tool-execution{padding:12px;border:1px solid var(--border);border-radius:7px;}.markdown-content h1,.markdown-content h2,.markdown-content h3{line-height:1.5;margin-top:24px;margin-bottom:12px;}.markdown-content p,.markdown-content ul,.markdown-content ol{margin-bottom:14px;}.markdown-content li{padding-left:2px;}
    .markdown-content>:last-child{margin-bottom:0;}
    pre,code,.tool-output,.tool-command{font-family:ui-monospace,"Cascadia Code",monospace;font-size:12px;}pre{max-width:100%;overflow:auto;}p,li,.assistant-text{overflow-wrap:anywhere;}table{display:block;max-width:100%;overflow:auto;}img{max-width:100%;}a{color:var(--accent);}
    .workspace-history-overview summary{font:500 12px/1.8 system-ui;color:var(--dim);cursor:pointer;width:fit-content;}.workspace-history-overview[open] summary{margin-bottom:10px;}
    .workspace-history-nav-toggle{display:grid;place-items:center;flex:none;width:32px;height:32px;border:0;border-radius:6px;background:transparent;color:var(--dim);padding:0;cursor:pointer;}
    .workspace-history-nav-toggle:hover{background:var(--selectedBg);color:var(--accent);}button:focus-visible,summary:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
    #sidebar.is-collapsed{display:none;}#sidebar.is-collapsed .tree-container,#sidebar.is-collapsed .tree-status{display:none;}
    .workspace-history-nav-backdrop{position:absolute;inset:var(--history-toolbar-height,84px) 0 0;z-index:10;background:#00000026;border:0;cursor:pointer;}.workspace-history-nav-backdrop[hidden]{display:none;}
    .tree-node{overflow:hidden;white-space:nowrap;}.sidebar-filters{display:flex;flex-wrap:wrap;}
    @media(min-width:900px){#app{grid-template-columns:clamp(232px,22vw,280px) minmax(0,1fr);}#sidebar,#sidebar.open{position:relative;grid-area:2 / 1;inset:auto;width:100%!important;height:100%;border-right:1px solid var(--border);box-shadow:none;}#content{grid-area:2 / 2;padding:24px clamp(24px,3vw,48px) 40px;}.header-info{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:24px;row-gap:5px;}#app.workspace-history-list-collapsed{grid-template-columns:0 minmax(0,1fr);}.workspace-history-nav-backdrop{display:none;}}
    @media(max-width:399px){.sidebar-header{padding:8px 10px;gap:8px;}.sidebar-controls{gap:6px;}#content{padding:16px 12px 28px;}.header{padding:12px;}}
    ::-webkit-scrollbar{width:5px;height:5px;}::-webkit-scrollbar-thumb{background:${border};border-radius:5px;}
  </style>`;
  const presentation = `<script>
    (() => {
      const app = document.querySelector('#app');
      const content = document.querySelector('#content');
      // 只保存当前文档中的可见记录及偏移，宽度变化时恢复同一阅读位置。
      const capture = () => {
        if (!content) return null;
        const box = content.getBoundingClientRect(), top = box.top;
        const header = content.querySelector('#header-container');
        const nodes = content.querySelector('#messages')?.children;
        let element = header && header.getBoundingClientRect().bottom > top + 1 ? header : null;
        // 从可见区域定位，隐藏记录不会干扰锚点，也无需逐条测量长历史。
        if (!element) for (const inset of [4,16,32,64]) {
          element = document.elementsFromPoint(box.left + box.width / 2, Math.min(box.bottom - 1, top + inset)).map(node => node.closest('#messages > [id]')).find(Boolean);
          if (element) break;
        }
        if (!element && nodes?.length) {
          let low = 0, high = nodes.length;
          while (low < high) { const middle = (low + high) >> 1; if (nodes[middle].getBoundingClientRect().bottom <= top + 1) low = middle + 1; else high = middle; }
          element = nodes[Math.min(low, nodes.length - 1)];
        }
        return {element, offset: element ? element.getBoundingClientRect().top - top : 0, scroll: content.scrollTop};
      };
      let anchor = null, restoring = false, restoreFrame = 0, scrollFrame = 0;
      const remember = () => { if (!restoring) anchor = capture(); };
      const restore = () => {
        cancelAnimationFrame(restoreFrame);
        restoring = true;
        restoreFrame = requestAnimationFrame(() => {
          if (content && anchor) {
            if (anchor.element?.isConnected) content.scrollTop += anchor.element.getBoundingClientRect().top - content.getBoundingClientRect().top - anchor.offset;
            else content.scrollTop = anchor.scroll;
          }
          restoring = false; remember();
        });
      };
      content?.addEventListener('scroll', () => { cancelAnimationFrame(scrollFrame); scrollFrame = requestAnimationFrame(remember); }, {passive:true});
      if (content && typeof ResizeObserver !== 'undefined') {
        let width = 0;
        new ResizeObserver(() => { const next = content.clientWidth; if (width && next !== width) restore(); else if (!anchor) remember(); width = next; }).observe(content);
      }
      const sidebar = document.querySelector('#sidebar');
      if (sidebar && app) {
        const toolbar = sidebar.querySelector('.sidebar-header');
        if (toolbar) app.prepend(toolbar);
        const toggle = document.createElement('button'); toggle.type = 'button';
        toggle.className = 'workspace-history-nav-toggle';
        toggle.setAttribute('aria-controls', 'tree-container');
        toggle.innerHTML = '<svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M13 9h5m-5 4h5"/></svg>';
        const backdrop = document.createElement('button'); backdrop.type = 'button'; backdrop.className = 'workspace-history-nav-backdrop'; backdrop.setAttribute('aria-label', '关闭历史导航'); backdrop.tabIndex = -1; app.append(backdrop);
        const update = () => {
          const open = !sidebar.classList.contains('is-collapsed'); const label = open ? '收起列表' : '展开列表';
          toggle.setAttribute('aria-label', label); toggle.title = label; toggle.setAttribute('aria-expanded', String(open));
          app.classList.toggle('workspace-history-list-collapsed', !open); backdrop.hidden = !open || innerWidth >= 900;
        };
        const setOpen = open => { if (innerWidth >= 900) { remember(); restore(); } sidebar.classList.toggle('is-collapsed', !open); update(); };
        let manuallyChanged = false;
        const fit = () => { if (!manuallyChanged) sidebar.classList.toggle('is-collapsed', innerWidth < 900); update(); };
        toggle.addEventListener('click', () => { manuallyChanged = true; setOpen(sidebar.classList.contains('is-collapsed')); });
        const controls = toolbar?.querySelector('.sidebar-controls') || sidebar;
        controls.prepend(toggle); fit(); addEventListener('resize', fit);
        const measureToolbar = () => { if (toolbar) app.style.setProperty('--history-toolbar-height', toolbar.getBoundingClientRect().height + 'px'); };
        measureToolbar(); if (toolbar && typeof ResizeObserver !== 'undefined') new ResizeObserver(measureToolbar).observe(toolbar); else addEventListener('resize', measureToolbar);
        backdrop.addEventListener('click', () => { manuallyChanged = true; setOpen(false); toggle.focus(); });
        document.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.defaultPrevented && innerWidth < 900 && !sidebar.classList.contains('is-collapsed')) { event.preventDefault(); setOpen(false); toggle.focus(); } });
        sidebar.addEventListener('click', event => { if (innerWidth < 900 && event.target.closest('.tree-node')) setOpen(false); });
        toolbar?.querySelector('#tree-search')?.addEventListener('input', event => { if (event.target.value.trim() && sidebar.classList.contains('is-collapsed')) setOpen(true); });
        toolbar?.addEventListener('click', event => { if (event.target.closest('[data-filter]') && sidebar.classList.contains('is-collapsed')) setOpen(true); });
      }
      const localize = () => {
        const search = document.querySelector('#tree-search');
        if (search) search.placeholder = '搜索完整历史…';
        const labels = {default:['默认','隐藏设置记录'],'no-tools':['隐藏工具','默认记录中隐藏工具结果'],'user-only':['用户','只显示用户消息'],'labeled-only':['标记','只显示已标记记录'],all:['全部','显示全部记录']};
        document.querySelectorAll('[data-filter]').forEach(button => { const label = labels[button.dataset.filter]; if (label) { if (button.textContent !== label[0]) button.textContent = label[0]; button.title = label[1]; } });
        const actions = {'toggle-thinking':'思考','toggle-tools':'工具输出','toggle-hidden-messages':'隐藏消息'};
        document.querySelectorAll('[data-action]').forEach(button => { const label = actions[button.dataset.action]; if (label) { if (button.textContent !== label) button.textContent = label; button.title = '切换' + label; } });
        const download = document.querySelector('.download-json-btn'); if (download) download.title = '下载完整 JSONL 记录';
        const names = {'Date:':'时间','Models:':'模型','Messages:':'消息','Tool Calls:':'工具调用','Tokens:':'Token','Cost:':'费用'};
        document.querySelectorAll('.info-label').forEach(label => { const name = names[label.textContent.trim()]; if (name) label.textContent = name; });
        const overview = document.querySelector('.header-info');
        if (overview && !overview.closest('.workspace-history-overview')) {
          const details = document.createElement('details'); details.className = 'workspace-history-overview';
          const summary = document.createElement('summary'); summary.textContent = '记录概览';
          const heading = overview.closest('.header')?.querySelector('h1');
          overview.before(details); details.append(summary); if (heading) details.append(heading); details.append(overview);
        }
      };
      localize(); document.addEventListener('click', localize);
      // SDK 切换筛选可能重新生成概览，适配仅补充展示，不替换原事件。
      const header = document.querySelector('#header-container');
      if (header) new MutationObserver(localize).observe(header, {childList:true,subtree:true});
    })();
  </script>`;
  const base = baseUrl ? `<meta name="pi-share-base-url" content="${baseUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}">` : "";
  return html.replace(/<\/head>/i, `${base}${style}</head>`).replace(/<\/body>/i, `${presentation}</body>`);
}
