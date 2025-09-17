import Fastify from "fastify";

// === Public widget served by your API ===
const PUBLIC_API = "https://lozano-ai-chat-production.up.railway.app/api/chat"; // your live API endpoint
const WIDGET_JS = `(() => {
  const API='${PUBLIC_API}';
  const SIGN='widget_dev';

  function h(t,a={},c=[]){
    const e=document.createElement(t);
    Object.entries(a).forEach(([k,v])=>{
      if(k==='style') Object.assign(e.style,v);
      else if(k.startsWith('on')) e.addEventListener(k.slice(2),v);
      else e.setAttribute(k,v)
    });
    c.forEach(x=>e.appendChild(typeof x==='string'?document.createTextNode(x):x));
    return e;
  }

  let open=false, sessionId=crypto.randomUUID(), msgs=[];
  const launcher=h('button',{onclick:toggle,style:{
    position:'fixed',right:'16px',bottom:'16px',borderRadius:'9999px',
    padding:'14px 18px',boxShadow:'0 10px 25px rgba(0,0,0,.15)',
    background:'#0f172a',color:'#fff',zIndex:999999,cursor:'pointer'
  }},['Chat with Lozano AI']);

  const panel=h('div',{style:{
    position:'fixed',right:'16px',bottom:'78px',width:'360px',maxWidth:'95vw',
    height:'540px',maxHeight:'70vh',background:'#fff',borderRadius:'16px',
    boxShadow:'0 20px 50px rgba(0,0,0,.2)',overflow:'hidden',display:'none',
    zIndex:999999
  }});

  const header=h('div',{style:{
    padding:'12px 16px',background:'#0f172a',color:'#fff',display:'flex',
    justifyContent:'space-between',alignItems:'center',fontFamily:'system-ui'
  }},[
    h('div',{},[
      h('strong',{},['Lozano AI']),
      h('div',{style:{fontSize:'12px',opacity:.8}},['Licensed FL GC • CGC1532629'])
    ]),
    h('button',{onclick:toggle,style:{color:'#fff',background:'transparent',border:'0',fontSize:'18px'}},['×'])
  ]);

  const body=h('div',{style:{
    padding:'12px',height:'calc(100% - 120px)',overflow:'auto',
    fontFamily:'system-ui',fontSize:'14px',lineHeight:'1.4'
  }});

  const inputWrap=h('div',{style:{display:'flex',gap:'8px',padding:'12px'}});
  const input=h('input',{placeholder:'Tell us about your project (city/ZIP helps!)',style:{
    flex:'1',border:'1px solid #e5e7eb',borderRadius:'10px',padding:'10px',fontFamily:'inherit'
  }});
  const send=h('button',{onclick:sendMsg,style:{
    padding:'10px 14px',borderRadius:'10px',border:'1px solid #0f172a',
    background:'#0f172a',color:'#fff',fontFamily:'inherit',cursor:'pointer'
  }},['Send']);

  inputWrap.append(input,send);
  panel.append(header,body,inputWrap);
  document.body.append(launcher,panel);

  function toggle(){
    open=!open; panel.style.display=open?'block':'none';
    if(open && msgs.length===0){
      pushBot('Hey! What are you planning — kitchen, bath, addition, roof/soffit, concrete, or something else?')
    }
  }
  function pushUser(t){ msgs.push({role:'user',content:t}); draw('me',t) }
  function pushBot(t){ msgs.push({role:'assistant',content:t}); draw('bot',t) }
  function draw(w,t){
    const wrap=h('div',{style:{margin:'8px 0',textAlign:w==='me'?'right':'left'}},
      [h('span',{style:{display:'inline-block',padding:'8px 10px',borderRadius:'10px',
      maxWidth:'85%',background:w==='me'?'#e2e8f0':'#f8fafc'}},[t])]);
    body.append(wrap); body.scrollTop=body.scrollHeight;
  }

  function extractFields(hist){
    const text=hist.map(m=>m.content).join('\\n');
    return {
      name: /name is ([^\\n\\.]+)/i.exec(text)?.[1],
      phone: /(\\+?1?[-.\\s]?)?\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}/.exec(text)?.[0],
      email: /[\\w.-]+@[\\w.-]+\\.[A-Za-z]{2,}/.exec(text)?.[0],
      zipcode: /\\b(\\d{5})(?:-\\d{4})?\\b/.exec(text)?.[1],
      city: /\\b(North Port|Sarasota|Siesta Key|Englewood|Venice|Osprey|Port Charlotte|Myakka|Tampa|Fort Myers)\\b/i.exec(text)?.[1],
      projectType: /(kitchen|bath(room)?|addition|roof(ing)?|soffit|fascia|concrete|driveway|remodel|painting|flooring)/i.exec(text)?.[1],
      description: text.slice(-600)
    };
  }
  function sign(payload){ return SIGN }

  async function sendMsg(){
    const text=(input.value||'').trim(); if(!text) return;
    input.value=''; pushUser(text);
    const captured=extractFields(msgs);
    const payload={ sessionId: crypto.randomUUID(), url: location.href, messages: msgs, captured };
    try {
      const res=await fetch(API,{
        method:'POST',
        headers:{'Content-Type':'application/json','x-widget-signature':sign(JSON.stringify(payload))},
        body:JSON.stringify(payload)
      });
      const data=await res.json();
      if(data.answer) pushBot(data.answer);
      if(data.persisted) pushBot('Got it — a project manager will text/email you shortly to lock a time. Anything else you want to add?');
    } catch (e) {
      pushBot('Hmm, connection issue. Try again in a moment.');
    }
  }
})();`;

// === Fastify app ===
const app = Fastify({ logger: true });

// Health
app.get("/health", async () => ({ ok: true, ts: Date.now() }));

// Serve the widget
app.get("/widget.js", async (req, reply) => {
  reply.header("Content-Type", "application/javascript; charset=utf-8");
  reply.send(WIDGET_JS);
});

// Start
const port = Number(process.env.PORT || 8787);
app.listen({ port, host: "0.0.0.0" })
  .then(() => console.log(`API up on :${port}`))
  .catch((e) => { console.error(e); process.exit(1); });
