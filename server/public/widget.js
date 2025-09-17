  const panel = h('div',{style:{
    position:'fixed',
    right:'16px',
    bottom:'78px',
    width:'360px',
    maxWidth:'95vw',
    height:'540px',
    maxHeight:'70vh',
    background:'#fff',
    borderRadius:'16px',
    boxShadow:'0 20px 50px rgba(0,0,0,.2)',
    overflow:'hidden',
    display:'none',
    zIndex:999999,
    display:'flex',
    flexDirection:'column'
  }});

  const header = h('div',{style:{
    padding:'12px 16px',
    background:'#0f172a',
    color:'#fff',
    display:'flex',
    justifyContent:'space-between',
    alignItems:'center',
    fontFamily:'system-ui'
  }},[
    h('div',{},[
      h('strong',{},['Lozano AI']),
      h('div',{style:{fontSize:'12px',opacity:.8}},['Licensed FL GC • CGC1532629'])
    ]),
    h('button',{onclick:toggle,style:{color:'#fff',background:'transparent',border:'0',fontSize:'18px'}},['×'])
  ]);

  const body = h('div',{style:{
    flex:'1',
    padding:'12px',
    overflow:'auto',
    fontFamily:'system-ui',
    fontSize:'14px',
    lineHeight:'1.4'
  }});

  const inputWrap = h('div',{style:{
    display:'flex',
    gap:'8px',
    padding:'12px',
    borderTop:'1px solid #e5e7eb',
    background:'#f9fafb'
  }});
