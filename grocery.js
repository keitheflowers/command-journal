/* The Family Save grocery list: grouped by store section, check off while
   shopping, build it from the meal plan (Vector AI writes a real ingredient
   list when it's on; otherwise meals are split into their parts).
   Stored in data.grocery (included in backups). Shown on the Fitness tab
   under the meal plan. */
(function(){
'use strict';
const AISLES=['Produce','Meat & Seafood','Dairy & Eggs','Bakery','Pantry','Frozen','Snacks & Drinks','Household','Other'];
const GUESS=[
 [/\b(apple|banana|berr|grape|orange|lemon|lime|avocado|tomato|lettuce|spinach|kale|salad|broccoli|carrot|onion|garlic|pepper|potato|cucumber|zucchini|mushroom|celery|cilantro|herb|fruit|veg|corn|squash|green bean|asparagus|cabbage)/i,'Produce'],
 [/\b(chicken|beef|steak|pork|turkey|ham|bacon|sausage|salmon|tuna|shrimp|fish|ground|meat)/i,'Meat & Seafood'],
 [/\b(milk|cheese|yogurt|butter|egg|cream|sour cream|cottage)/i,'Dairy & Eggs'],
 [/\b(bread|bun|bagel|tortilla|roll|muffin|croissant|pita)/i,'Bakery'],
 [/\b(rice|pasta|noodle|bean|flour|sugar|oil|vinegar|sauce|salsa|spice|salt|cereal|oat|peanut butter|jam|broth|stock|can|soup|quinoa|honey|ketchup|mustard|mayo)/i,'Pantry'],
 [/\b(frozen|ice cream|pizza)/i,'Frozen'],
 [/\b(chip|cracker|cookie|snack|soda|juice|coffee|tea|water|popcorn|granola)/i,'Snacks & Drinks'],
 [/\b(paper towel|toilet|soap|detergent|trash bag|dish|shampoo|toothpaste|foil|wrap|napkin|wipes)/i,'Household']];
const guess=n=>(GUESS.find(([re])=>re.test(n))||[0,'Other'])[1];
function g(){if(!data.grocery||typeof data.grocery!=='object')data.grocery={};const x=data.grocery;x.items=Array.isArray(x.items)?x.items:[];return x;}
const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim().replace(/(?:es|s)$/,'');
function add(items,source='manual'){
 // merge duplicates of unchecked items by name
 const L=g().items;let added=0;
 for(const it of items){const name=String(it.name||'').trim().replace(/^(?:some|a|an)\s+/i,'').slice(0,60);if(!name)continue;
  const ex=L.find(x=>!x.checked&&norm(x.name)===norm(name));
  if(ex){if(it.qty&&!ex.qty)ex.qty=it.qty;continue;}
  L.push({id:uuid(),name:name[0].toUpperCase()+name.slice(1),qty:it.qty?String(it.qty).slice(0,30):'',aisle:AISLES.includes(it.aisle)?it.aisle:guess(name),checked:false,source,added:stamp()});added++;}
 return added;
}
// Split spoken/typed lists: "milk, eggs and 2 pounds of chicken"
function splitList(text){return String(text).split(/\s*(?:,|;|\band\b|\bplus\b|&)\s*/i).map(s=>s.trim()).filter(Boolean).map(s=>{const m=s.match(/^((?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|a dozen|a couple(?: of)?)\s*(?:lbs?|pounds?|oz|ounces?|gallons?|cans?|bags?|boxes?|packs?|bunch(?:es)?|dozen|loaf|loaves|jars?|bottles?)?(?:\s+of)?)\s+(.+)$/i);return m&&/\d|dozen|lb|pound|oz|gallon|can|bag|box|pack|bunch|loa|jar|bottle|couple/i.test(m[1])?{name:m[2],qty:m[1].replace(/\s+of$/i,'')}:{name:s};});}
function mealsFor(week){if(window.Nutrition)return window.Nutrition.plannedMeals(week);const mp=(window.Fitness&&window.Fitness.mealPlan())||{},t=new Date();const s=new Date(t);s.setDate(t.getDate()-t.getDay()+7*week);const out=[];for(let i=0;i<7;i++){const d=new Date(s);d.setDate(s.getDate()+i);const k=day(d);for(const [slot,m] of Object.entries(mp[k]||{}))if(m)out.push({date:k,slot,meal:m});}return out;}
async function fromPlan(week){
 const meals=mealsFor(week);if(!meals.length){toast('No meals planned for that week yet.');return;}
 if(window.VectorAI&&window.VectorAI.enabled()&&navigator.onLine!==false){
  toast('Vector is writing your grocery list…');
  try{const r=await window.VectorAI.interpret(`Make a grocery list of the ingredients needed for these planned family meals. One grocery_add action per ingredient, combined across meals, with sensible quantities for a family. Skip basics most kitchens already have (salt, pepper, cooking oil) unless the meal is built around them. Meals: ${meals.map(m=>`${m.slot} ${m.date}: ${m.meal}`).join('; ')}`);
   const items=(r.actions||[]).filter(a=>a.kind==='grocery').flatMap(a=>a.items||[]);
   if(items.length){const n=add(items,'meal');persist();toast(`Added ${n} item${n===1?'':'s'} from ${meals.length} planned meal${meals.length===1?'':'s'}.`);return;}
  }catch(e){toast(e.message+' Using a simple list instead.');}
 }
 const parts=[];for(const m of meals)for(const p of m.meal.split(/\s*(?:,|&|\band\b|\bwith\b|\bw\/)\s*/i))if(p.trim().length>1)parts.push({name:p.trim()});
 const n=add(parts,'meal');persist();toast(`Added ${n} item${n===1?'':'s'} from your meal plan. Turn on Vector AI for full ingredient lists.`);
}
window.Grocery={AISLES,items:()=>g().items,add,splitList,inject:()=>inject()};

// ---- panel ------------------------------------------------------------
let week=0,showDone=true;
const css=document.createElement('style');css.textContent=`
.gr-add{display:flex;gap:8px}.gr-add input{flex:1}.gr-sec{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7f93a8;margin:14px 0 2px;font-weight:700}
.gr-it{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid #18283b;font-size:14.5px}.gr-it:last-child{border:0}.gr-it .q{font-size:12px;color:#8ea3b8}.gr-it.done .nm{text-decoration:line-through;color:#6d8196}.gr-it .nm{flex:1;min-width:0}`;
document.head.appendChild(css);
function panelHtml(){
 const L=g().items,open=L.filter(i=>!i.checked),done=L.filter(i=>i.checked);
 const groups=AISLES.map(a=>[a,open.filter(i=>i.aisle===a)]).filter(([,x])=>x.length);
 const row=i=>`<div class="gr-it${i.checked?' done':''}"><input type="checkbox" class="check" data-gr="tog" data-id="${i.id}" ${i.checked?'checked':''} aria-label="Got ${esc(i.name)}"><span class="nm">${esc(i.name)}${i.qty?` <span class="q">· ${esc(i.qty)}</span>`:''}</span><button class="x" data-gr="del" data-id="${i.id}" aria-label="Remove">✕</button></div>`;
 return `<div class="panel" id="gr-panel"><div class="header"><h2>Grocery list${open.length?` · ${open.length}`:''}</h2>${done.length?`<button class="btn alt sm" data-gr="clear">Clear ${done.length} checked</button>`:''}</div>
  <div class="gr-add"><input id="grIn" maxlength="200" placeholder="Add items: milk, eggs, 2 lb chicken"><button class="btn sm" data-gr="add">Add</button></div>
  <div class="actions" style="margin-top:10px"><button class="btn alt sm" data-gr="plan" data-v="0">From this week’s meals</button><button class="btn alt sm" data-gr="plan" data-v="1">From next week’s meals</button></div>
  ${open.length?groups.map(([a,x])=>`<div class="gr-sec">${a}</div>${x.map(row).join('')}`).join(''):`<div class="empty">${done.length?'All done! 🛒':'Your list is empty.'}</div>`}
  ${done.length?`<div class="gr-sec">In the cart</div>${done.map(row).join('')}`:''}
  <p class="hint" style="margin-top:10px">Hands-free: “Vector, open Family Save, add milk and eggs to the grocery list”. With Vector AI on: “make a grocery list for next week’s meals” or “what’s on the grocery list?”</p></div>`;
}
function inject(){
 const sec=document.getElementById('meals')||document.getElementById('fitness');if(!sec||sec.classList.contains('hidden'))return;
 const old=sec.querySelector('#gr-panel');if(old)old.remove();
 const plan=sec.querySelector('#nu-plan')||[...sec.querySelectorAll('.panel')].find(p=>/^Meal plan/.test(p.querySelector('h2')?.textContent||''));
 (plan||sec.lastElementChild)?.insertAdjacentHTML('afterend',panelHtml());
}
document.addEventListener('click',e=>{
 const b=e.target.closest('#gr-panel [data-gr]');if(!b)return;const a=b.dataset.gr,x=g();
 if(a==='add'){const v=document.getElementById('grIn').value;const n=add(splitList(v));if(!n){toast('Nothing new to add.');return;}toast(`Added ${n}.`);}
 else if(a==='tog'){const it=x.items.find(i=>i.id===b.dataset.id);if(it)it.checked=b.checked;}
 else if(a==='del'){x.items=x.items.filter(i=>i.id!==b.dataset.id);}
 else if(a==='clear'){x.items=x.items.filter(i=>!i.checked);}
 else if(a==='plan'){fromPlan(+b.dataset.v);return;}
 else return;
 persist();
});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='grIn'){e.preventDefault();document.querySelector('#gr-panel [data-gr="add"]').click();}});
const baseRender=window.render;
window.render=function(){baseRender.apply(this,arguments);if(view==='meals')inject();};
})();
