(() => {
  // --- run after DOM is ready ---
  function onReady(fn){ if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }

  // --- tiny element helper ---
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

  onReady(() => {
    if (document.getElementById('lozano-chat-launcher')) return; // avoid duplicates

    let open = false;
    let msgs = [];
    const sessionId = crypto.randomUUID();

    // --- launcher button ---
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

    // --- panel container (desktop defaults) ---
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
        h('strong', {}, ['Lozano AI']),
        h('div', { style:{ fontSize:'12px', opacity:.8 }}, ['Licensed FL GC • CGC1532629'])
      ]),
      h('button', { onclick: toggle, style: { color:'#fff', background:'transparent', border:'0', fontSize:'18px', cursor:'pointer' } }, ['×'])
    ]);

    const body = h('div', { id:'lozano-chat-body', style: {
      flex:'1', padding:'12px', overflow:'auto',
      fontFamily:'system-ui', fontSize:'14px', lineHeight:'1.4', WebkitOverflowScrolling:'touch'
    }});

    // input area (with safe-area padding for iOS)
    const inputWrap = h('div', { style: {
      display:'flex', gap:'8px', padding:'12px',
      paddingBottom:'calc(12px + env(safe-area-inset-bottom))',
      borderTop:'1px solid #e5e7eb', background:'#f9fafb'
    }});
    const input = h('input', {
      placeholder:'Tell us about your project (city/ZIP helps!)',
      style: { flex:'1', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'10px', fontFamily:'inherit' }
    });
    const send = h('button', {
      onclick: sendMsg,
      style: { padding:'10px 14px', borderRadius:'10px', border:'1px solid #0f172a', background:'#0f172a', color:'#fff', fontFamily:'inherit', cursor:'pointer' }
    }, ['Send']);

    inputWrap.append(input, send);
    panel.append(header, body, inputWrap);
    document.body.append(launcher, panel);

    // --- mobile responsive behavior ---
    function applyMobileLayout() {
      const isMobile = window.matchMedia('(max-width: 640px)').matches;
      if (isMobile) {
        // fill the screen nicely on phones; use 100dvh for keyboard-safe height
        Object.assign(panel.style, {
          right: '0', bottom: '0', left: '0',
          width: '100vw', maxWidth: '100vw',
          height: 'calc(100dvh - 0px)',
          maxHeight: '100dvh',
          borderRadius: '12px 12px 0 0'
        });
        // keep launcher a bit higher so it doesn't overlap mobile browser bars
        launcher.style.bottom = '20px';
        launcher.style.right  = '16px';
      } else {
        Object.assign(panel.style, {
          right:'16px', bottom:'78px', left:'',
          width:'360px', maxWidth:'95vw',
          height:'540px', maxHeight:'70vh',
          borderRadius:'16px'
        });
        launcher.style.bottom = '16px';
        launcher.style.right  = '16px';
      }
    }
    applyMobileLayout();

    // handle orientation / resize / keyboard open
    window.addEventListener('resize', applyMobileLayout);
    window.addEventListener('orientationchange', applyMobileLayout);

    // keep input visible when focusing (mobile keyboards)
    input.addEventListener('focus', () => {
      setTimeout(() => body.scrollTop = body.scrollHeight, 50);
    });

    function toggle(){
      open = !open;
      panel.style.display = open ? 'flex' : 'none';
      if (open && msgs.length === 0) {
        pushBot('Hey! What are you planning — kitchen, bath, addition, roof/soffit, concrete, or something else?');
      }
    }

    function draw(who, text){
      const bubble = h('div', { style: { margin:'8px 0', textAlign: (who === 'me' ? 'right':'left') } }, [
        h('span', { style: {
          display:'inline-block', padding:'8px 10px', borderRadius:'10px',
          maxWidth:'85%', background: (who === 'me' ? '#e2e8f0' : '#f8fafc')
        }}, [text])
      ]);
      body.appendChild(bubble);
      body.scrollTop = body.scrollHeight;
    }
    function pushUser(t){ msgs.push({ role:'user', content:t }); draw('me', t); }
    function pushBot(t){ msgs.push({ role:'assistant', content:t }); draw('bot', t); }

    async function sendMsg(){
      const text = (input.value || '').trim();
      if (!text) return;
      input.value = '';
      pushUser(text);

      const payload = { sessionId, url: location.href, messages: msgs };
      try {
        const res  = await fetch(API, {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'x-widget-signature': SIGN },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.answer) pushBot(data.answer);
        if (data.persisted) pushBot('Got it — a project manager will text/email you shortly to lock a time. Anything else you want to add?');
      } catch {
        pushBot('Hmm, connection issue. Try again in a moment.');
      }
    }
  });
})();

