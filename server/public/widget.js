(() => {
  const API = 'https://lozano-ai-chat-production.up.railway.app/api/chat';
  const SIGN = 'widget_dev';

  // ---------- avatar (replace with your own image URL anytime) ----------
  const AVATAR =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'>
      <rect width='100%' height='100%' rx='12' ry='12' fill='#FFD700'/>
      <circle cx='32' cy='26' r='12' fill='#111'/>
      <path d='M12 56c4-10 14-14 20-14s16 4 20 14' fill='#111'/>
    </svg>`);

  // ---------- tiny chime (inline WAV) ----------
  const CHIME_SRC =
    "data:audio/wav;base64,UklGRlQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYAAAACAAACaW5mbyB3YXYgYmVlcAAA" +
    "AAAAAAB/////AAAAAP///wAAAP///wAAAP7+/v7+/v7+/v7+/////wAAAAD///8AAAAA/v7+/////wAAAP///wAAAP///wAAAAAA";
  let muted = localStorage.getItem('lozano_chat_muted') === '1';
  const chimeEl = new Audio(CHIME_SRC);
  chimeEl.volume = 0.3;
  function playChime(){ if(!muted){ try{ chimeEl.currentTime=0; chimeEl.play().catch(()=>{});}catch{}} }

  // ---------- helper ----------
  function h(tag, attrs = {}, kids = []) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'style') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    kids.forEach(x => el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x));
    return el;
  }

  // ---------- state ----------
  let open = false;
  let msgs = [];
  let sessionId = localStorage.getItem('lozano_chat_session') || crypto.randomUUID();
  localStorage.setItem('lozano_chat_session', sessionId);

  // ---------- launcher ----------
  const launcher = h('button', {
    onclick: toggle,
    style: {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      borderRadius: '9999px',
      padding: '14px 18px',
      boxShadow: '0 10px 25px rgba(0,0,0,.15)',
      background: '#FFD700', // gold
      color: '#000',
      fontWeight: '600',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
      zIndex: 999999,
      cursor: 'pointer',
      border: 'none'
    }
  }, ['Chat with us']);

  // ---------- panel ----------
  const panel = h('div', {
    style: {
      position: 'fixed',
      right: '16px',
      bottom: '78px',
      width: '360px',
      maxWidth: '95vw',
      height: '540px',
      maxHeight: '70vh',
      background: '#1e1e1e', // dark gray
      borderRadius: '16px',
      boxShadow: '0 20px 50px rgba(0,0,0,.2)',
      overflow: 'hidden',
      display: 'none',
      zIndex: 999999,
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
      boxSizing: 'border-box'
    }
  });

  // header
  const muteBtn = h('button', {
    onclick: () => { muted = !muted; localStorage.setItem('lozano_chat_muted', muted ? '1' : '0'); muteBtn.textContent = muted ? '🔕' : '🔔'; },
    title: 'Sound on/off',
    style: { color:'#fff', background:'transparent', border:0, fontSize:'18px', cursor:'pointer', marginRight:'8px' }
  }, [muted ? '🔕' : '🔔']);

  const closeBtn = h('button', {
    onclick: toggle,
    style: { color:'#fff', background:'transparent', border:0, fontSize:'18px', cursor:'pointer' }
  }, ['×']);

  const headerRight = h('div', { style: { display:'flex', alignItems:'center', gap:'6px' } }, [muteBtn, closeBtn]);
  const headerLeft = h('div', { style: { display:'flex', alignItems:'center', gap:'8px' } }, [
    h('img', { src: AVATAR, alt: 'Martha', style: { width:'22px', height:'22px', borderRadius:'999px' } }),
    h('div', {}, ['Chat'])
  ]);

  const header = h('div', {
    style: {
      padding:'12px 16px',
      background:'#2b2b2b',
      color:'#fff',
      display:'flex',
      justifyContent:'space-between',
      alignItems:'center',
      fontSize:'16px',
      fontWeight:'600',
      boxSizing:'border-box'
    }
  }, [headerLeft, headerRight]);

  const body = h('div', {
    style: {
      padding:'12px',
      height:'calc(100% - 120px)', // header + input area
      overflowY:'auto',
      fontSize:'14px',
      lineHeight:'1.4',
      boxSizing:'border-box'
    }
  });

  // input area (fix cut-off with box-sizing)
  const inputWrap = h('div', {
    style: { display:'flex', gap:'8px', padding:'12px', background:'#2b2b2b', boxSizing:'border-box' }
  });

  const input = h('input', {
    placeholder: 'Type your message…',
    style: {
      flex:'1',
      border:'1px solid #444',
      borderRadius:'10px',
      padding:'10px',
      font:'14px/1.2 inherit',
      background:'#fff',
      color:'#000',
      boxSizing:'border-box'
    },
    onkeydown: (e) => { if (e.key === 'Enter') sendMsg(); }
  });

  const send = h('button', {
    onclick: sendMsg,
    style: {
      padding:'10px 14px',
      borderRadius:'10px',
      border:'none',
      background:'#FFD700', // gold
      color:'#000',
      fontWeight:'600',
      cursor:'pointer',
      boxSizing:'border-box'
    }
  }, ['Send']);

  inputWrap.append(input, send);
  panel.append(header, body, inputWrap);
  document.body.append(launcher, panel);

  // ---------- behavior ----------
  function toggle(){
    open = !open;
    panel.style.display = open ? 'block' : 'none';
    if (open && msgs.length === 0) {
      pushBot("Hi! This is Martha with Lozano Construction. What can I help you with?");
    }
    localStorage.setItem('lozano_chat_open', open ? '1' : '0');
  }

  function pushUser(t){ msgs.push({ role:'user', content:t }); draw('me', t); }
  function pushBot(t){ msgs.push({ role:'assistant', content:t }); draw('bot', t); playChime(); }

  function draw(who, text){
    if (who === 'bot'){
      const row = h('div', { style:{ display:'flex', alignItems:'flex-end', gap:'8px', margin:'8px 0' } }, [
        h('img', { src: AVATAR, alt:'Martha', style:{ width:'20px', height:'20px', borderRadius:'999px' } }),
        h('span', { style:{
          display:'inline-block', padding:'8px 10px', borderRadius:'10px', maxWidth:'80%', background:'#333', color:'#fff'
        }}, [text])
      ]);
      body.append(row); body.scrollTop = body.scrollHeight; return;
    }
    const wrap = h('div', { style:{ margin:'8px 0', textAlign:'right' } }, [
      h('span', { style:{
        display:'inline-block', padding:'8px 10px', borderRadius:'10px', maxWidth:'80%', background:'#444', color:'#fff'
      }}, [text])
    ]);
    body.append(wrap); body.scrollTop = body.scrollHeight;
  }

  async function sendMsg(){
    const text = (input.value || '').trim();
    if (!text) return;
    input.value = '';
    pushUser(text);

    const payload = { sessionId, url: location.href, messages: msgs };
    try {
      const res = await fetch(API, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'x-widget-signature': SIGN },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.answer) pushBot(data.answer);
      // You can also read data.meta.language / data.meta.english_log here if you ever want UI badges/logs.
    } catch {
      pushBot('Hmm, connection issue. Try again in a moment.');
    }
  }

  // ---------- auto open first visit ----------
  window.addEventListener('load', () => {
    const wasOpen = localStorage.getItem('lozano_chat_open') === '1';
    if (!wasOpen && !localStorage.getItem('lozano_chat_seen')) {
      toggle(); // auto-open on first visit
      localStorage.setItem('lozano_chat_seen', '1');
    } else if (wasOpen) {
      toggle(); // reopen if it was open before
    }
  });
})();
