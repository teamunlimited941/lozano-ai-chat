(() => {
  function onReady(fn){ if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  function h(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'style' && v && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const c of [].concat(children || [])) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return el;
  }

  const API  = 'https://lozano-ai-chat-production.up.railway.app/api/chat';
  const SIGN = 'widget_dev';
  const AGENT_NAME = 'Maria • Lozano Construction';

  onReady(() => {
    if (document.getElementById('lozano-chat-launcher')) return;

    let open = false;
    let msgs = [];
    const sessionId = crypto.randomUUID();

    const launcher = h('button', {
      id: 'lozano-chat-launcher',
      onclick: toggle,
      style: {
        position:'fixed', right:'16px', bottom:'16px',
        borderRadius:'9999px', padding:'14px 18px',
        boxShadow:'0 10px 25px rgba(0,0,0,.15)',
        background:'#0f172a', color:'#fff', zIndex: 999999,
        cursor:'pointer', border:'0', fontFamily:'system-ui'
      }
    }, ['Chat with Lozano AI']);

    const panel = h('div', {
      id: 'lozano-chat-panel',
      style: {
        position:'fixed', right:'16px', bottom:'78px',
        width:'360px', maxWidth:'95vw',
        height:'540px', maxHeight:'70vh',
        background:'#fff', borderRadius:'16px',
        boxShadow:'0 20px 50px rgba(0,0,0,.2)',
        overflow:'hidden', display:'none', zIndex: 999999,
        display:'flex', flexDirection:'column'
      }
    });

    const header = h('div', { style: {
      padding:'12px 16px', background:'#0f172a', color:'#fff',
      display:'flex', justifyContent:'space-between', alignItems:'center',
      fontFamily:'system-ui'
    }}, [
      h('div', {}, [
        h('strong', {}, ['Chat']),
        h('div', { style:{ fontSize:'12px', opacity:.8 }}, [AGENT_NAME])
      ]),
      h('button', { onclick: toggle, style: { color:'#fff', background:'transparent', border:'0', fontSize:'18px', cursor:'pointer' } }, ['×'])
    ]);

    const body = h('div', { id:'lozano-chat-body', style: {
      flex:'1', padding:'12px', overflow:'auto',
      fontFamily:'system-ui', fontSize:'14px', lineHeight:'1.4', WebkitOverflowScrolling:'touch',
      background:'#fafafa'
    }});

    // Input as TEXTAREA (like Messages), with Shift+Enter for newline
    const inputWrap = h('div', { style: {
      display:'flex', gap:'8px', padding:'10px',
      paddingBottom:'calc(10px + env(safe-area-inset-bottom))',
      borderTop:'1px solid #e5e7eb', background:'#fff', alignItems:'flex-end'
    }});
    const ta = h('textarea', {
      rows:'2',
      placeholder:'Type your message… (city/ZIP helps)',
      style: {
        flex:'1', border:'1px solid #e5e7eb', borderRadius:'14px',
        padding:'10px 12px', fontFamily:'inherit', resize:'none', outline:'none',
        maxHeight:'120px', lineHeight:'1.3', boxShadow:'inset 0 1px 2px rgba(0,0,0,.04)'
      },
      oninput: autoGrow,
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMsg();
        }
      }
    });
    const send = h('button', {
      onclick: sendMsg,
      style: {
        padding:'10px 14px', borderRadius:'10px',
        border:'1px solid #0f172a', background:'#0f172a',
        color:'#fff', fontFamily:'inherit', cursor:'pointer', whiteSpace:'nowrap'
      }
    }, ['Send']);

    inputWrap.append(ta, send);
    panel.append(header, body, inputWrap);
    document.body.append(launcher, panel);

    // Mobile fill
    function applyMobileLayout() {
      const isMobile = window.matchMedia('(max-width: 640px)').matches;
      if (isMobile) {
        Object.assign(panel.style, {
          right:'0', bottom:'0', left:'0',
          width:'100vw', maxWidth:'100vw',
          height:'calc(100dvh - 0px)', maxHeight:'100dvh',
          borderRadius:'12px 12px 0 0'
        });
        launcher.style.bottom = '20px';
      } else {
        Object.assign(panel.style, {
          right:'16px', bottom:'78px', left:'',
          width:'360px', maxWidth:'95vw',
          height:'540px', maxHeight:'70vh',
          borderRadius:'16px'
        });
        launcher.style.bottom = '16px';
      }
    }
    applyMobileLayout();
    window.addEventListener('resize', applyMobileLayout);
    window.addEventListener('orientationchange', applyMobileLayout);
    ta.addEventListener('focus', () => setTimeout(() => body.scrollTop = body.scrollHeight, 50));

    function autoGrow(){
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    }

    // UI helpers
    function draw(who, text){
      const wrap = h('div', { style: { margin:'8px 0', display:'flex', justifyContent: (who==='me'?'flex-end':'flex-start') } }, [
        h('span', { style: {
          display:'inline-block', padding:'8px 12px', borderRadius:'14px',
          maxWidth:'85%',
          background: (who === 'me' ? '#DCF1FF' : '#fff'),
          border: (who === 'me' ? '1px solid #cfe7fb' : '1px solid #eee'),
          color:'#0f172a', boxShadow:'0 1px 2px rgba(0,0,0,.04), 0 6px 16px rgba(0,0,0,.04)'
        }}, [text])
      ]);
      body.appendChild(wrap);
      body.scrollTop = body.scrollHeight;
    }
    function pushUser(t){ msgs.push({ role:'user', content:t }); draw('me', t); }
    function pushAgent(t){ msgs.push({ role:'assistant', content:t }); draw('bot', t); }

    function toggle(){
      open = !open;
      panel.style.display = open ? 'flex' : 'none';
      if (open && msgs.length === 0) {
        pushAgent("Hi! I’m Maria with Lozano Construction. What are you planning — kitchen, bath, addition, roofing/soffit, concrete, or something else? If you can share your city or ZIP, I’ll get you scheduled faster.");
      }
    }

    async function sendMsg(){
      const text = (ta.value || '').trim();
      if (!text) return;
      ta.value = ''; autoGrow();
      pushUser(text);

      const payload = { sessionId, url: location.href, messages: msgs };

      try {
        const res  = await fetch(API, {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'x-widget-signature': SIGN },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.answer) pushAgent(data.answer);
        if (data.persisted) pushAgent('Perfect — I’ll text/email you shortly to lock a time.');
      } catch {
        pushAgent('Hmm, connection issue on my side. Mind trying again in a moment?');
      }
    }
  });
})();


