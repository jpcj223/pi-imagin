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
    :root{color-scheme:${dark ? "dark" : "light"};--body-bg:${bg};--container-bg:${bg};--info-bg:${panel};--text:${text};--dim:${muted};--muted:${muted};--border:${border};--accent:${accent};--borderAccent:${accent};--selectedBg:${selected};--hover:${panel};--thinkingText:${muted};--userMessageBg:${panel};--userMessageText:${text};--toolPendingBg:${panel};--toolSuccessBg:${panel};--toolErrorBg:${dark ? "#39262b" : "#fff3f3"};--toolTitle:${accent};--toolOutput:${text};--mdHeading:${text};--mdText:${text};--customMessageBg:${panel};--customMessageText:${text};--customMessageLabel:${accent};--line-height:20px;}
    html,body{height:100%;overflow:hidden;}body{font:12px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;}
    #app{display:flex;flex-direction:column;height:100dvh;min-height:0;overflow:hidden;}
    #sidebar,#sidebar.open{position:relative;inset:auto;transform:none;width:100%!important;min-width:0;max-width:none;flex:0 0 auto;height:clamp(150px,30vh,230px);border:0;border-bottom:1px solid var(--border);background:${panel};}
    #hamburger,#sidebar-overlay,#sidebar-resizer,.sidebar-close{display:none!important;}
    .sidebar-header{padding:10px 12px 6px;}.sidebar-controls,.sidebar-filters{padding:0;}.sidebar-filters{gap:4px;margin-top:7px;}
    .sidebar-search{font:inherit;padding:6px 9px;border:1px solid var(--border);border-radius:6px;}
    .filter-btn{font:11px/1.4 system-ui;padding:4px 7px;border:1px solid var(--border);border-radius:5px;color:var(--dim);}
    .filter-btn.active{background:var(--selectedBg);color:var(--accent);border-color:var(--border);}
    .tree-container{min-height:0;overflow:auto;padding:2px 8px;}.tree-status{font:10px/1.4 system-ui;padding:3px 12px;color:var(--dim);border-color:var(--border);}
    .tree-item{font:11px/1.6 system-ui;border-radius:4px;}
    #content{flex:1;min-height:0;overflow:auto;padding:12px;align-items:stretch;}
    #content>*{width:100%;max-width:none;min-width:0;}.header{padding:10px;background:${panel};border:1px solid var(--border);border-radius:8px;margin-bottom:16px;overflow-wrap:anywhere;}
    .header h1{font:600 11px/1.6 system-ui;margin-bottom:8px;overflow-wrap:anywhere;}.help-bar{gap:6px;margin-bottom:10px;}.help-hint{display:none;}.help-actions{gap:5px;}
    .header-toggle-btn,.download-json-btn{font:11px/1.4 system-ui;padding:5px 7px;border-radius:5px;}.info-item{display:grid;grid-template-columns:65px minmax(0,1fr);font:11px/1.65 system-ui;}.info-label{min-width:0;margin:0;}.info-value{overflow-wrap:anywhere;}
    #messages{gap:18px;}.user-message{padding:10px;border-radius:8px;border:1px solid var(--border);}.assistant-message{padding:0;}.tool-execution{padding:10px;border:1px solid var(--border);border-radius:7px;}
    pre,code,.tool-output,.tool-command{font-family:ui-monospace,"Cascadia Code",monospace;font-size:11px;}pre{max-width:100%;overflow:auto;}p,li,.assistant-text{overflow-wrap:anywhere;}table{display:block;max-width:100%;overflow:auto;}img{max-width:100%;}a{color:var(--accent);}
    .workspace-history-overview summary{font:500 11px/1.8 system-ui;color:var(--dim);cursor:pointer;}.workspace-history-overview[open] summary{margin-bottom:7px;}
    ::-webkit-scrollbar{width:5px;height:5px;}::-webkit-scrollbar-thumb{background:${border};border-radius:5px;}
  </style>`;
  const presentation = `<script>
    (() => {
      const overview = document.querySelector('.header-info');
      if (overview) {
        const details = document.createElement('details');
        details.className = 'workspace-history-overview';
        const summary = document.createElement('summary');
        summary.textContent = '记录概览';
        overview.before(details); details.append(summary, overview);
      }
      const localize = () => {
        const search = document.querySelector('#tree-search');
        if (search) search.placeholder = '搜索完整历史…';
        const labels = {default:'默认','no-tools':'隐藏工具','user-only':'用户','labeled-only':'标记',all:'全部'};
        document.querySelectorAll('[data-filter]').forEach(button => { button.textContent = labels[button.dataset.filter] || button.textContent; });
        const actions = {'toggle-thinking':'思考','toggle-tools':'工具输出','toggle-hidden-messages':'隐藏消息'};
        document.querySelectorAll('[data-action]').forEach(button => { if (actions[button.dataset.action]) button.textContent = actions[button.dataset.action]; });
      };
      localize(); document.addEventListener('click', localize);
    })();
  </script>`;
  const base = baseUrl ? `<meta name="pi-share-base-url" content="${baseUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}">` : "";
  return html.replace(/<\/head>/i, `${base}${style}</head>`).replace(/<\/body>/i, `${presentation}</body>`);
}
