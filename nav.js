/* The Family Save navigation: five main tabs, each with sub-tabs.
   The original per-view tab buttons stay in the DOM (modules add to them)
   but are hidden; this bar drives openView(). */
(function(){
'use strict';
const GROUPS=[
 {id:'home',label:'Home',icon:'🏠',views:[['today','Today'],['dashboard','Dashboard']]},
 {id:'plan',label:'Plan',icon:'🗓️',views:[['tasks','Tasks'],['calendar','Calendar'],['reviews','Reviews']]},
 {id:'money',label:'Money',icon:'💵',views:[['finance','Money']]},
 {id:'health',label:'Health',icon:'💪',views:[['fitness','Overview'],['meals','Meals'],['strength','Training']]},
 {id:'more',label:'Settings',icon:'⚙️',views:[['settings','Settings']]}];
const groupOf=v=>GROUPS.find(g=>g.views.some(x=>x[0]===v))||GROUPS[0];
const last={};try{Object.assign(last,JSON.parse(localStorage.getItem('navLast')||'{}'));}catch(_){}
const old=document.getElementById('tabs');
const bar=document.createElement('nav');bar.id='mainNav';bar.setAttribute('aria-label','Main');
old.insertAdjacentElement('beforebegin',bar);
old.style.setProperty('display','none','important'); // an older rule forces the tab row visible
const css=document.createElement('style');css.textContent=`
#mainNav{position:sticky;top:0;z-index:5;background:#070a12ee;backdrop-filter:blur(14px);padding:10px 0 8px}
#mainNav .g{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}#mainNav .g button{border:1px solid #1f3348;background:#0e1624;color:#9fb3c6;border-radius:12px;padding:8px 2px 7px;font-size:11.5px;font-weight:650;display:flex;flex-direction:column;align-items:center;gap:2px}
#mainNav .g button span{font-size:17px;line-height:1}#mainNav .g button.on{background:#0f3149;border-color:#46d9f5;color:#fff;box-shadow:0 0 14px #46d9f533}
#mainNav .s{display:flex;gap:6px;margin-top:8px;overflow-x:auto;scrollbar-width:none}#mainNav .s::-webkit-scrollbar{display:none}#mainNav .s:empty{display:none}
#mainNav .s button{flex:none;border:1px solid #24394f;background:none;color:#9fb3c6;border-radius:20px;padding:6px 14px;font-size:12.5px;font-weight:650}#mainNav .s button.on{background:#14304a;border-color:#46d9f5;color:#fff}`;
document.head.appendChild(css);
function draw(){
 const g=groupOf(view);
 bar.innerHTML=`<div class="g">${GROUPS.map(x=>`<button data-g="${x.id}" class="${x.id===g.id?'on':''}" aria-current="${x.id===g.id?'page':'false'}"><span aria-hidden="true">${x.icon}</span>${x.label}</button>`).join('')}</div>
  <div class="s">${g.views.length>1?g.views.filter(([v])=>document.getElementById(v)).map(([v,l])=>`<button data-v="${v}" class="${v===view?'on':''}">${l}</button>`).join(''):''}</div>`;
}
bar.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.g){const g=GROUPS.find(x=>x.id===b.dataset.g);const v=last[g.id]&&document.getElementById(last[g.id])?last[g.id]:g.views[0][0];openView(v);}
 else if(b.dataset.v)openView(b.dataset.v);
});
const baseRender=window.render;
window.render=function(){baseRender.apply(this,arguments);const g=groupOf(view);last[g.id]=view;try{localStorage.setItem('navLast',JSON.stringify(last));}catch(_){}draw();};
window.Nav={GROUPS,groupOf};
draw();
})();
