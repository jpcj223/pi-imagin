/** 首次绘制前仅恢复尺寸和显示偏好，不读取或缓存聊天正文。约束与 panel-layout 保持一致。 */
export const WORKSPACE_LAYOUT_INIT_SCRIPT = `(()=>{try{
  const root=document.documentElement,w=innerWidth,clamp=(n,min,max)=>Math.round(Math.max(min,Math.min(max,n)));
  const stored=key=>{const value=localStorage.getItem(key);return value!==null&&Number.isFinite(parseInt(value,10))?parseInt(value,10):null;};
  const leftOpen=new URLSearchParams(location.search).get('sidebar')!=='collapsed',rightOpen=w>640&&localStorage.getItem('pi-workspace-right-open')!=='false';
  const preferredLeft=stored('pi-sidebar-width')??220;
  let left=clamp(preferredLeft,180,w<=640?480:Math.min(480,w-40-(w<960?320:420)-(w>=880&&rightOpen?300:0)));
  const available=w-40-(leftOpen?left:0),rightMax=w<880?1200:Math.min(760,Math.max(260,Math.round(available*.5)),available-(w<960?320:420));
  const right=clamp(stored('pi-right-panel-width')??clamp((w-260)*.28,260,360),260,rightMax);
  if(w>640)left=clamp(preferredLeft,180,Math.min(480,w-40-(w<960?320:420)-(w>=880&&rightOpen?right:0)));
  root.style.setProperty('--workspace-initial-sidebar-width',left+'px');root.style.setProperty('--workspace-initial-right-width',right+'px');
  root.dataset.workspaceRightOpen=String(rightOpen);
  root.style.setProperty('--chat-content-max-width',clamp(stored('pi-chat-content-width')??820,820,2000)+'px');
  root.style.setProperty('--chat-content-font-size',clamp(stored('pi-chat-content-font-size')??14,12,24)+'px');
}catch{}})();`;
