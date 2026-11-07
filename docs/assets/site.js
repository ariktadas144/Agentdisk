
const announce=document.createElement('span');
announce.setAttribute('role','status');
announce.style.cssText='position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
document.body.append(announce);
document.querySelectorAll('[data-copy]').forEach(button=>{
  const label=button.textContent;let timer;
  button.addEventListener('click',async()=>{
    const code=document.getElementById(button.dataset.copy);clearTimeout(timer);
    try {await navigator.clipboard.writeText(code.textContent);button.textContent='Copied';announce.textContent='Command copied to clipboard.';}
    catch {const range=document.createRange();range.selectNodeContents(code);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);button.textContent='Selected';announce.textContent='Command selected. Use your keyboard to copy.';}
    timer=setTimeout(()=>{button.textContent=label;announce.textContent='';},2200);
  });
});
const examples=JSON.parse(document.getElementById('example-data').textContent);
const checks=[...document.querySelectorAll('.report-row input')];
const preview=document.getElementById('plan-preview');
function selected(){return examples.filter(item=>item.kind==='rebuildable'&&checks.some(box=>box.value===item.id&&box.checked&&!box.disabled));}
function update(){
  const items=selected(),size=items.reduce((sum,item)=>sum+item.freedMiB,0)/1024;
  document.getElementById('selection-summary').textContent=items.length+' selected · '+size.toFixed(2)+' GiB in this example';
  document.getElementById('preview-plan').disabled=items.length===0;preview.hidden=true;
}
checks.forEach(box=>box.addEventListener('change',update));
const filters=[...document.querySelectorAll('[data-filter]')];
filters.forEach(button=>button.addEventListener('click',()=>{
  filters.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  document.querySelectorAll('.report-row').forEach(row=>row.hidden=button.dataset.filter!=='all'&&row.dataset.kind!==button.dataset.filter);
}));
document.getElementById('preview-plan').addEventListener('click',()=>{
  const items=selected();if(!items.length)return;
  const size=items.reduce((sum,item)=>sum+item.freedMiB,0)/1024;
  document.getElementById('plan-description').textContent=items.length+' example folders · '+size.toFixed(2)+' GiB: '+items.map(item=>item.path).join(', ')+'. No files moved.';
  preview.hidden=false;preview.focus({preventScroll:true});
});
document.getElementById('reset-report').addEventListener('click',()=>{
  checks.forEach(box=>box.checked=!box.disabled);
  filters.find(button=>button.dataset.filter==='all').click();update();
  document.getElementById('preview-plan').focus({preventScroll:true});
});
const setups={
  download:{description:'Install the release binary first, then check it and scan your projects folder.',command:'agentdisk --version\nagentdisk scan -p ~/Projects'},
  source:{description:'Build from source with Rust 1.82 or newer. On Windows, the checkout also includes scripts/install.ps1.',command:'git clone https://github.com/laaielichter/Agentdisk\ncd Agentdisk\ncargo install --locked --path crates/agentdisk-cli'},
  claude:{description:'Install the agentdisk binary first. Then add the marketplace and the Claude Code plugin.',command:'/plugin marketplace add laaielichter/agentdisk\n/plugin install agentdisk@agentdisk'},
  mcp:{description:'Install the binary first, then add this server to your client’s MCP configuration. The full guide covers Codex, VS Code and other clients.',command:JSON.stringify({mcpServers:{agentdisk:{command:'agentdisk',args:['mcp']}}},null,2)}
};
const tabs=[...document.querySelectorAll('[data-setup]')];
function select(tab){
  tabs.forEach(item=>{const on=item===tab;item.setAttribute('aria-selected',String(on));item.tabIndex=on?0:-1;});
  document.getElementById('setup-panel').setAttribute('aria-labelledby',tab.id);
  document.getElementById('setup-description').textContent=setups[tab.dataset.setup].description;
  document.getElementById('setup-command').textContent=setups[tab.dataset.setup].command;
  document.querySelector('#setup-panel [data-copy]').textContent='Copy';
}
tabs.forEach((tab,index)=>{
  tab.addEventListener('click',()=>select(tab));
  tab.addEventListener('keydown',event=>{
    let next;
    if(event.key==='ArrowRight')next=(index+1)%tabs.length;
    if(event.key==='ArrowLeft')next=(index-1+tabs.length)%tabs.length;
    if(event.key==='Home')next=0;
    if(event.key==='End')next=tabs.length-1;
    if(next!==undefined){event.preventDefault();select(tabs[next]);tabs[next].focus();}
  });
});
