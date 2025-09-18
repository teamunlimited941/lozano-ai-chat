(() => {
  // ---------- helpers ----------
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

  // ---------- theme & config ----------
  const COLORS = {
    headerBg: '#2d2d2d',       // dark gray for header + send
    gold: '#f2c200',           // launcher (yellow-gold)
    userBubbleBg: '#2d2d2d',   // dark gray user bubble
    userBubbleText: '#ffffff',
    agentBubbleBg: '#ffffff',
    agentBubbleText: '#1f2937',
    bodyBg: '#f7f7f7',
    border: '#e5e7eb',
    placeholder: '#6b7280'
  };
  const API  = 'https://lozano-ai-chat-production.up.railway.app/api/chat';
  const SIGN = 'widget_dev';
  const AUTO_OPEN_DELAY_MS = 1500;
  const KEY_SUPPRESS_THIS_VISIT = 'lozano_chat_suppress_this_visit';
  const AGENT_NAME = 'Maria • Lozano Construction';

  onReady(() => {
    if (document.getElementById('lozano-launcher')) return;

    // 1) Load Inter font (so Elementor/theme can't override)
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap';
    document.head.appendChild(link);

    // 2) Inject strong CSS overrides
    const css = `
#lozano-chat-panel, #lozano-chat-panel * {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
  font-size: 15px !important;
  line-height: 1.5 !important;
}
#lozano-chat-header { background: ${COLORS.headerBg} !important; color: #fff !important; }
#lozano-send { background: ${COLORS.headerBg} !important; border-color: ${COLORS.headerBg} !important; color: #fff !important; }
#lozano-textarea { color: #111 !important; background: #fff !important; }
#lozano-textarea::placeholder { color: ${COLORS.placeholder} !important; opacity: 1 !important; }
#lozano-launcher { background: ${COLORS.gold} !important; color: #111 !important; font-weight: 600 !important; }
`;
    document.head.appendChild(h('style', {}, [css]));

    let open = false;
    let msgs = [];
    const sessionId = crypto.randomUUID();

    // ---------- launcher ----------
    const launcher = h('button', {
      id: 'lozano-launcher',
      onclick: toggle,
      style: {
        position:'fixed', right:'16px', bottom:'16px',
        borderRadius:'9999px', padding:'14px 18px',
        boxShadow:'0 10px 25px rgba(0,0,0,.15)',
        zIndex: 999999, cursor:'pointer', border:'0',
        transition:'transform .2s ease'
      }
    }, ['Chat with us']);
    setTimeout(() => { launcher.style.transform = 'scale(1.04)'; setTimeout(()=> launcher.style.transform='scale(1)', 300); }, 1000);

    // ---------- panel ----------
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

    // ---------- header ----------
    const header = h('div', { id:'lozano-chat-header', style: {
      padding:'12px 16px', display:'flex',
      justifyContent:'space-between', alignItems:'center'
    }}, [
      h('div', {}, [
        h('strong', { style:{ letterSpacing:'.2px' } }, ['Chat']),
        h('div', { style:{ fontSize:'12px', opacity:.9, marginTop:'2px' }}, [AGENT_NAME])
      ]),
      h('button', { title:'Minimize', onclick: minimize, style: { color:'#fff', background:'transparent', border:'0', fontSize:'18px', cursor:'pointer' } }, ['×'])
    ]);

    // ---------- body ----------
    const body = h('div', { id:'lozano-chat-body', style: {
      flex:'1', padding:'12px', overflow:'auto',
      WebkitOverflowScrolling:'touch',
      background: COLORS.bodyBg
    }});

    // typing indicator
    const typing = h('div', { id:'lozano-typing', style: {
      display:'none', margin:'6px 0', fontSize:'12px', color:COLORS.placeholder
    }}, ['Maria is typing…']);

    // ---------- input ----------
    const inputWrap = h('div', { style: {
      display:'flex', gap:'8px', padding:'10px',
      paddingBottom:'calc(10px + env(safe-area-inset-bottom))',
      borderTop:`1px solid ${COLORS.border}`, background:'#fff', alignItems:'flex-end'
    }});
    const ta = h('textarea', {
      id:'lozano-textarea',
      rows:'2',
      placeholder:'Type your message.',
      style: {
        flex:'1',
        border:`1px solid ${COLORS.border}`,
        borderRadius:'14px',
        padding:'10px 12px',
        resize:'none', outline:'none',
        maxHeight:'120px',
        boxShadow:'inset 0 1px 2px rgba(0,0,0,.04)'
      },
      oninput: autoGrow,
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
      }
    });
    const send = h('button', {
      id:'lozano-send',
      onclick: sendMsg,
      style: {
        padding:'10px 14px', borderRadius:'10px',
        border:`1px solid ${COLORS.headerBg}`,
        cursor:'pointer', whiteSpace:'nowrap'
      }
    }, ['Send']);

    inputWrap.append(ta, send);
    panel.append(header, body, typing, inputWrap);
    document.body.append(launcher, panel);

    // ---------- mobile layout ----------
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

    function autoGrow(){ ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; }

    // ---------- bubbles ----------
    function bubble(text, opts){
      const wrap = h('div', { style: {
        margin:'8px 0', display:'flex', justifyContent: (opts.right ? 'flex-end':'flex-start')
      }}, [
        h('span', { style: {
          display:'inline-block', padding:'9px 12px', borderRadius:'16px',
          maxWidth:'85%',
          background: opts.bg, color: opts.color,
          border: `1px solid ${opts.border || 'transparent'}`,
          boxShadow:'0 1px 2px rgba(0,0,0,.04), 0 6px 16px rgba(0,0,0,.04)'
        }}, [text])
      ]);
      return wrap;
    }
    function pushUser(t){ msgs.push({ role:'user', content:t }); body.appendChild(bubble(t, { right:true, bg:COLORS.userBubbleBg, color:COLORS.userBubbleText })); body.scrollTop = body.scrollHeight; }
    function pushAgent(t){ msgs.push({ role:'assistant', content:t }); body.appendChild(bubble(t, { right:false, bg:COLORS.agentBubbleBg, color:COLORS.agentBubbleText, border:COLORS.border })); body.scrollTop = body.scrollHeight; }

    // ---------- minimize / toggle / open ----------
    function minimize(){
      open = false;
      panel.style.display = 'none';
      try { sessionStorage.setItem(KEY_SUPPRESS_THIS_VISIT, '1'); } catch {}
    }
    function toggle(){
      open = !open;
      if (open) openPanel();
      else minimize();
    }
    function openPanel(){
      panel.style.display = 'flex';
      if (msgs.length === 0) {
        pushAgent("Hi! This is Maria with Lozano Construction. What can I help you with?");
      }
    }

    // ---------- auto-open once per visit ----------
    (function maybeAutoOpen(){
      let suppressed = false;
      try { suppressed = sessionStorage.getItem(KEY_SUPPRESS_THIS_VISIT) === '1'; } catch {}
      if (!suppressed) {
        setTimeout(() => { if (!open) { open = true; openPanel(); } }, AUTO_OPEN_DELAY_MS);
      }
    })();

    // ---------- sending ----------
    async function sendMsg(){
      const text = (ta.value || '').trim();
      if (!text) return;
      ta.value = ''; autoGrow();
      pushUser(text);

      typing.style.display = 'block';
      const payload = { sessionId, url: location.href, messages: msgs };
      try {
        const res  = await fetch(API, {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'x-widget-signature': SIGN },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        typing.style.display = 'none';
        if (data.answer)    pushAgent(data.answer);
        if (data.persisted) pushAgent('Perfect — I’ll text/email you shortly to lock a time.');
      } catch {
        typing.style.display = 'none';
        pushAgent('Hmm, connection issue on my side. Mind trying again in a moment?');
      }
    }
  });
})();



