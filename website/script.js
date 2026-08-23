/* ============================================================
   DreamCabs — single-page scroll site
   GSAP 3.12 + ScrollTrigger. Every reveal is reversible, so
   scrolling back up plays the animation backwards.
   ============================================================ */

const DESKTOP = '(min-width: 901px)';
const MOBILE  = '(max-width: 900px)';

/* ---------------- utilities ---------------- */

/* A pinned section has to be landed on exactly or its pin starts part-way
   through; everything else is offset so the heading clears the fixed nav. */
function goTo(t){
  const el = document.querySelector(t);
  if(!el) return;
  const top    = el.getBoundingClientRect().top + window.pageYOffset;
  const pinned = el.classList.contains('panel-flow');
  window.scrollTo({top: Math.max(0, pinned ? top : top - 70), behavior:'smooth'});
  closeMenu();
}

/* ---------------- static behaviour ---------------- */

const db = document.getElementById('dashBars');
if(db){
  for(let i=0;i<40;i++){
    const b = document.createElement('i');
    b.dataset.h = (16 + Math.random()*80);
    db.appendChild(b);
  }
}

const burger = document.getElementById('burger');
const mmenu  = document.getElementById('mmenu');
function closeMenu(){ if(mmenu) mmenu.classList.remove('open'); }
if(burger) burger.addEventListener('click', ()=> mmenu.classList.toggle('open'));
document.querySelectorAll('#mmenu a').forEach(a=>{
  a.addEventListener('click', e=>{ e.preventDefault(); goTo(a.getAttribute('href')); });
});
document.querySelectorAll('.menu a[href^="#"], .fcol a[href^="#"], .foot-brand a[href^="#"]').forEach(a=>{
  a.addEventListener('click', e=>{
    const h = a.getAttribute('href');
    if(h && h.startsWith('#') && h.length > 1){ e.preventDefault(); goTo(h); }
  });
});

/* ---------------- apps: three product panes ----------------
   One switch function shared by the tab buttons and, on desktop, by the
   pinned scroll that advances Customer → Driver → Admin. */
const appTabs  = [...document.querySelectorAll('#apps .tab')];
const appPanes = [...document.querySelectorAll('#apps .pane')];
let appsIndex = 0;
/* set by the desktop pin so a tab click scrolls to that pane's slice of the
   pinned range instead of swapping underneath the reader */
let appsSeek = null;

function setPane(i){
  if(!appPanes.length) return;
  i = Math.max(0, Math.min(appPanes.length - 1, i));
  if(i === appsIndex && appPanes[i].classList.contains('on')) return;
  appsIndex = i;
  appTabs.forEach((t,n)=> t.classList.toggle('on', n === i));
  appPanes.forEach((p,n)=> p.classList.toggle('on', n === i));
  if(window.gsap) gsap.fromTo(appPanes[i],{opacity:0,y:22},{opacity:1,y:0,duration:.5,ease:'power3.out'});
  if(appPanes[i].id === 'pane-admin'){
    const ab = document.getElementById('adminBars');
    if(ab) ab.classList.add('lit');
    runAdminCounts();
  }
}

appTabs.forEach((t,i)=>{
  t.addEventListener('click', ()=>{
    if(appsSeek){ appsSeek(i); return; }   /* desktop: let the scroll drive it */
    setPane(i);
    if(window.ScrollTrigger) ScrollTrigger.refresh();
  });
});

/* ============================================================
   EMAIL DELIVERY
   The site is static, so submissions are posted to FormSubmit's AJAX
   endpoint, which forwards them to MAIL_TO. Change MAIL_TO to switch the
   recipient (e.g. back to dreamcabs2025@gmail.com after testing).
   NOTE: FormSubmit sends a one-time activation email to a new address on
   its first submission — that link has to be clicked once before mail
   starts arriving.
   ============================================================ */
const MAIL_TO = 'masudimubashir@gmail.com';
const MAIL_ENDPOINT = 'https://formsubmit.co/ajax/' + MAIL_TO;

const SENT_MSG = 'Email sent successfully — the owner will get back to you shortly.';

async function sendMail(subject, fields){
  const res = await fetch(MAIL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(Object.assign({ _subject: subject, _template: 'table' }, fields))
  });
  let data = {};
  try { data = await res.json(); } catch(e){}
  if(!res.ok || String(data.success) === 'false'){
    throw new Error(data.message || ('Request failed (' + res.status + ')'));
  }
  return data;
}

function setMsg(el, text, state){
  if(!el) return;
  el.textContent = text;
  el.className = 'form-msg' + (state ? ' ' + state : '');
}

/* submit helper shared by both forms: validates, disables, reports */
async function submitForm({ form, msgEl, btn, subject, collect, onDone }){
  if(!form.reportValidity()) return;
  const original = btn.innerHTML;
  btn.disabled = true;
  setMsg(msgEl, 'Sending…', 'busy');
  try {
    await sendMail(subject, collect());
    setMsg(msgEl, SENT_MSG, 'ok');
    form.reset();
    if(onDone) onDone();
  } catch(err){
    setMsg(msgEl, 'Could not send: ' + err.message + '. Please email ' + MAIL_TO + ' directly.', 'err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

/* ---- contact form ---- */
const contactForm = document.getElementById('contactForm');
if(contactForm){
  contactForm.addEventListener('submit', e=>{
    e.preventDefault();
    submitForm({
      form: contactForm,
      msgEl: document.getElementById('contactMsg'),
      btn: contactForm.querySelector('button[type="submit"]'),
      subject: 'DreamCabs website — new contact enquiry',
      collect: ()=>({
        name:    contactForm.name.value.trim(),
        email:   contactForm.email.value.trim(),
        phone:   contactForm.phone.value.trim() || '—',
        message: contactForm.message.value.trim()
      })
    });
  });
}

/* ---- floating lead sheet (pitch deck / contact founder) ---- */
const leadWrap  = document.getElementById('leadWrap');
const leadForm  = document.getElementById('leadForm');
if(leadWrap && leadForm){
  const leadMsg = document.getElementById('leadMsg');
  const COPY = {
    deck: {
      title: 'Download the pitch deck',
      sub:   "Leave your name and email and we'll send it straight over.",
      subject: 'DreamCabs — pitch deck requested'
    },
    founder: {
      title: 'Contact the founder',
      sub:   "Leave your name and email and the founder will get back to you.",
      subject: 'DreamCabs — founder contact request'
    }
  };
  let leadKind = 'deck';

  function openLead(kind){
    leadKind = COPY[kind] ? kind : 'deck';
    document.getElementById('leadTitle').textContent = COPY[leadKind].title;
    document.getElementById('leadSub').textContent   = COPY[leadKind].sub;
    setMsg(leadMsg, '');
    leadWrap.hidden = false;
    setTimeout(()=> document.getElementById('leadName').focus(), 60);
  }
  function closeLead(){ leadWrap.hidden = true; }

  document.querySelectorAll('[data-lead]').forEach(b=>{
    b.addEventListener('click', ()=> openLead(b.dataset.lead));
  });
  document.getElementById('leadClose').addEventListener('click', closeLead);
  document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && !leadWrap.hidden) closeLead(); });

  leadForm.addEventListener('submit', e=>{
    e.preventDefault();
    submitForm({
      form: leadForm,
      msgEl: leadMsg,
      btn: document.getElementById('leadSend'),
      subject: COPY[leadKind].subject,
      collect: ()=>({
        message: leadKind === 'deck'
          ? 'You have been pitched by a customer — they requested the pitch deck.'
          : 'You have been pitched by a customer — they asked to contact the founder.',
        name:  leadForm.name.value.trim(),
        email: leadForm.email.value.trim()
      }),
      onDone: ()=> setTimeout(closeLead, 4000)
    });
  });
}

/* ---- newsletter ---- */
const newsBtn = document.querySelector('.nf button');
if(newsBtn){
  newsBtn.addEventListener('click', async ()=>{
    const input = newsBtn.parentElement.querySelector('input');
    const email = (input.value || '').trim();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ input.focus(); return; }
    newsBtn.disabled = true;
    try {
      await sendMail('DreamCabs — newsletter signup', { message: 'New newsletter signup.', email });
      input.value = '';
      alert(SENT_MSG);
    } catch(err){
      alert('Could not subscribe: ' + err.message);
    } finally { newsBtn.disabled = false; }
  });
}

const faqList = document.getElementById('faqList');
if(faqList){
  /* Every answer ships open. The toggle is therefore independent — clicking
     one item must not collapse the others and hide copy the reader was
     already looking at. */
  faqList.addEventListener('click', e=>{
    const q = e.target.closest('.fq');
    if(!q) return;
    const item = q.parentElement,
          a    = item.querySelector('.fa'),
          open = item.classList.toggle('open');
    a.style.maxHeight = open ? a.scrollHeight + 'px' : null;
    if(window.ScrollTrigger){ ScrollTrigger.refresh(); }
  });
}

function countUp(el){
  if(el.dataset.done) return;
  el.dataset.done = '1';
  const end = +el.dataset.count, pre = el.dataset.prefix || '';
  if(!window.gsap){ el.textContent = pre + end.toLocaleString('en-IN'); return; }
  gsap.to({v:0},{v:end, duration:1.7, ease:'power2.out',
    onUpdate:function(){ el.textContent = pre + Math.round(this.targets()[0].v).toLocaleString('en-IN'); }});
}
function runAdminCounts(){
  document.querySelectorAll('#pane-admin [data-count]').forEach(countUp);
}

/* ---------------- preloader ---------------- */

window.addEventListener('load', ()=>{
  const pre = document.getElementById('pre');
  if(!pre || !window.gsap){
    if(pre) pre.style.display = 'none';
    document.body.classList.remove('loading');
    if(window.gsap) init();
    return;
  }
  const bar = document.getElementById('plBar'), pc = document.getElementById('plPc');
  gsap.fromTo('#pre img',{opacity:0,y:14},{opacity:1,y:0,duration:.7,ease:'power3.out'});
  const p = {v:0};
  gsap.to(p,{v:100, duration:1.4, ease:'power2.inOut',
    onUpdate:()=>{ bar.style.width = p.v + '%'; pc.textContent = Math.round(p.v) + '%'; },
    onComplete:()=> gsap.to('#pre',{yPercent:-100, duration:.75, ease:'power4.inOut', delay:.1,
      onComplete:()=>{ pre.style.display='none'; document.body.classList.remove('loading'); init(); }})
  });
});

/* ============================================================
   INIT
   ============================================================ */

function init(){
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ignoreMobileResize:true});

  window.addEventListener('resize', () => { ScrollTrigger.refresh(); });

  /* ---- scroll progress + sticky nav ---- */
  ScrollTrigger.create({
    start:0, end:'max',
    onUpdate:s=>{
      const prog = document.getElementById('prog'), hdr = document.getElementById('hdr');
      if(prog) prog.style.width = (s.progress*100) + '%';
      if(hdr) hdr.classList.toggle('scrolled', s.scroll() > 60);
    }
  });

  /* ---- HERO: entrance only, no idle or hover motion ---- */
  if(document.getElementById('hero')){
  const tl = gsap.timeline({defaults:{ease:'power3.out'}});
  tl.to('#hero .eyebrow',{opacity:1,y:0,duration:.55})
    .to('#hero .hero-h .ln>span',{y:'0%',duration:.95,stagger:.11},'-=.25')
    .to('#hero .hero-sub',{opacity:1,y:0,duration:.6},'-=.5')
    .to('#hero .hero-cta',{opacity:1,y:0,duration:.6},'-=.45')
    .to('#hero .hero-proof',{opacity:1,y:0,duration:.6},'-=.45')
    .from('.stage-3d',{opacity:0,x:70,rotateY:-14,duration:1.15},'-=1.05')
    .from('.float-chip, .exp-badge',{opacity:0,scale:.82,duration:.55,stagger:.1},'-=.55')
    .from('.hero-blob, .hero-dot',{opacity:0,scale:.9,duration:.9,stagger:.06},'-=1.3');
  }

  /* ---- generic reveals ----
     toggleActions is onEnter / onLeave / onEnterBack / onLeaveBack.
     'play none none reverse' plays on the way down and rewinds only once
     the element has left back off the TOP of the screen. The old
     'play reverse play reverse' also reversed onLeave, which faded
     sections back to invisible while they were still on screen — that is
     what left whole panels blank. Nothing may be hidden while visible.

     immediateRender:false is the other half of that rule. By default a
     fromTo paints its "from" state the moment it is created, so every
     reveal on the page starts life invisible and only a correctly firing
     trigger brings it back — one stale measurement and the copy is gone.
     Deferring the from-state inverts the failure: an element that is
     never triggered simply stays visible. Fail visible, never blank. */
  const REVEAL = 'play none none reverse';

  gsap.utils.toArray('[data-reveal]').forEach(el=>{
    if(el.closest('#hero')) return;                 /* hero is driven by the intro timeline */
    if(el.classList.contains('strip-c')) return;    /* has its own staggered tween below —
                                                       two tweens on one opacity strand each other */
    gsap.fromTo(el,{opacity:0,y:38},{
      opacity:1, y:0, duration:.9, ease:'power3.out', immediateRender:false,
      scrollTrigger:{trigger:el, start:'top 92%', toggleActions:REVEAL}
    });
  });

  gsap.utils.toArray('.mask').forEach(m=>{
    const sp = m.querySelector('span');
    gsap.fromTo(sp,{y:'110%'},{y:'0%', duration:.95, ease:'power4.out', immediateRender:false,
      scrollTrigger:{trigger:m, start:'top 90%', toggleActions:REVEAL}});
  });

  /* ---- per-panel content lift, so every section animates in ---- */
  gsap.utils.toArray('.panel').forEach(panel=>{
    const inner = panel.querySelector('.panel-in, .wrap');
    if(!inner || panel.id === 'hero') return;
    gsap.fromTo(inner,{opacity:.25,y:46},{
      opacity:1, y:0, duration:1, ease:'power3.out', immediateRender:false,
      scrollTrigger:{trigger:panel, start:'top 78%', toggleActions:REVEAL}
    });
  });

  /* ---- counters ---- */
  gsap.utils.toArray('[data-count]').forEach(el=>{
    if(el.closest('#pane-admin')) return;
    ScrollTrigger.create({trigger:el, start:'top 92%', once:true, onEnter:()=>countUp(el)});
  });

  /* ---- driver earnings bars ---- */
  ScrollTrigger.create({trigger:'#drivers', start:'top 68%', end:'bottom 20%',
    onEnter:()=>document.querySelectorAll('#dashBars i').forEach((t,i)=>
      setTimeout(()=> t.style.transform = `scaleY(${t.dataset.h/100})`, i*18)),
    onLeaveBack:()=>document.querySelectorAll('#dashBars i').forEach(t=> t.style.transform = 'scaleY(0)')
  });

  ScrollTrigger.create({trigger:'#apps', start:'top 60%', onEnter:()=>{
    const ab = document.getElementById('adminBars');
    if(ab) ab.classList.add('lit');
  }});

  gsap.utils.toArray('.pane-phones .phone').forEach((p,i)=>{
    gsap.fromTo(p,{y:60,opacity:0},{y:0,opacity:1,duration:1,ease:"power3.out",delay:i*.1,immediateRender:false,
      scrollTrigger:{trigger:p, start:'top 94%', toggleActions:REVEAL}});
  });
  gsap.fromTo("#dashwin",{y:60,opacity:0},{y:0,opacity:1,duration:1.05,ease:"power3.out",immediateRender:false,
    scrollTrigger:{trigger:'#apps', start:'top 70%', toggleActions:REVEAL}});

  gsap.to('#sus .globe',{rotate:360, duration:70, repeat:-1, ease:'none'});

  /* ---- strip cards ---- */
  gsap.from(".strip-c",{opacity:0, y:40, duration:.8, stagger:.14, ease:"power3.out", immediateRender:false,
    scrollTrigger:{trigger:'.strip', start:'top 88%', toggleActions:REVEAL}});

  /* ---- CONTACT / FOOTER: settle in from the bottom right ---- */
  gsap.utils.toArray('#contact .cinfo .ci, #contact .form, #contact .cmap').forEach((el,i)=>{
    gsap.fromTo(el,{opacity:0, x:60, y:40},{
      opacity:1, x:0, y:0, duration:.9, delay:i*.07, ease:"power3.out", immediateRender:false,
      scrollTrigger:{trigger:'#contact', start:'top 72%', toggleActions:REVEAL}
    });
  });
  gsap.fromTo('footer .foot-top > *',{opacity:0, x:44, y:30},{
    opacity:1, x:0, y:0, duration:.8, stagger:.09, ease:"power3.out", immediateRender:false,
    scrollTrigger:{trigger:'footer', start:'top 88%', toggleActions:REVEAL}
  });

  /* ---- nav active link ---- */
  const links = [...document.querySelectorAll('.menu a')];
  links.forEach(a=>{
    const sec = document.querySelector(a.getAttribute('href'));
    if(!sec) return;
    ScrollTrigger.create({trigger:sec, start:'top 45%', end:'bottom 45%',
      onToggle:s=>{ if(s.isActive){ links.forEach(l=>l.classList.remove('active')); a.classList.add('active'); } }});
  });

  /* ==========================================================
     Screen-size dependent behaviour. gsap.matchMedia() tears
     everything down automatically when the query stops matching,
     so phones never run the pin or the horizontal track.
     ========================================================== */
  const mm = gsap.matchMedia();

  /* ---------- DESKTOP ---------- */
  mm.add(DESKTOP, ()=>{

    /* HERO — mockup scales up and tilts in 3D as the hero scrolls away */
    gsap.to('.stage-3d',{
      scale:1.12, rotateY:-4, rotateX:9, y:-40, ease:'none',
      scrollTrigger:{trigger:'#hero', start:'top top', end:'bottom top', scrub:.7}
    });
    gsap.to('.hero-copy',{y:-70, opacity:.35, ease:'none',
      scrollTrigger:{trigger:'#hero', start:'top top', end:'bottom top', scrub:.7}});
    gsap.to('.hero-grid-bg',{yPercent:14, ease:'none',
      scrollTrigger:{trigger:'#hero', start:'top top', end:'bottom top', scrub:true}});
    gsap.to('.hero-dot',{y:44, ease:'none',
      scrollTrigger:{trigger:'#hero', start:'top top', end:'bottom top', scrub:.8}});

    /* APPS — the scroll drives the three product panes.
       The stage pins, so the reader stays exactly where they stopped while
       Customer → Driver → Admin advance under them; when the last pane is
       done the pin releases and the page carries on into #passengers. */
    if(appPanes.length){
      const PER  = .85;                       /* viewport-heights per pane */
      const span = ()=> window.innerHeight * PER * appPanes.length;

      const appsST = ScrollTrigger.create({
        trigger:'#apps',
        start:'top top',
        end:()=> '+=' + span(),
        pin:'.apps-stage',
        anticipatePin:1,
        invalidateOnRefresh:true,
        /* Pins must be MEASURED in document order (#features, #steps, #apps),
           but this one is CREATED first. Without the priority it measured its
           start before #steps had inserted its pin-spacer, so it pinned a whole
           horizontal-track early and the steps cards showed through. */
        refreshPriority:1,
        onUpdate:s=>{
          setPane(Math.floor(s.progress * appPanes.length * .999));
          const el = document.getElementById('appsProg');
          if(el) el.style.transform = 'scaleX(' + s.progress + ')';
        }
      });

      /* a tab click scrolls to the middle of that pane's slice */
      appsSeek = i=>{
        const dest = appsST.start +
          (appsST.end - appsST.start) * ((i + .5) / appPanes.length);
        window.scrollTo({top:dest, behavior:'smooth'});
      };
    }

    /* FEATURES — pin the left column, cascade the cards, shift the background */
    const right = document.getElementById('fxRight');
    const cards = gsap.utils.toArray('.fxc');
    if(right){

    /* Bound the pin by the section itself. The old '+= card column height'
       end overshot past #features, so the pinned rail was still stuck to the
       viewport once the next section had scrolled in and its "Keep scrolling"
       hint bled over the top of the horizontal track. */
    ScrollTrigger.create({
      trigger:'#features',
      start:'top top',
      endTrigger:'#features',
      end:'bottom bottom',
      pin:'.fx-left',
      pinSpacing:false,
      anticipatePin:1,
      refreshPriority:3          /* first pinned section in the document */
    });

    cards.forEach(c=>{
      gsap.fromTo(c,
        {opacity:0, y:56, filter:'blur(14px)'},
        {opacity:1, y:0, filter:"blur(0px)", duration:.75, ease:"power3.out", immediateRender:false,
         scrollTrigger:{trigger:c, start:'top 92%', toggleActions:REVEAL}});
    });

    /* Background and the pinned rail's text darken/lighten on ONE scrubbed
       timeline, so the copy is legible at every point of the transition
       instead of only at the two ends. */
    gsap.timeline({
      scrollTrigger:{trigger:'#features', start:'top 60%', end:'top top', scrub:.6}
    })
    .to('#features', {backgroundColor:'#0b1622', ease:'none'}, 0)
    .to('#features .fx-left .sec-h, #features .fxs b',
        {color:'#ffffff', ease:'none'}, 0)
    .to('#features .fx-left .sec-p, #features .fxs > span, #features .fx-hint',
        {color:'rgba(255,255,255,.62)', ease:'none'}, 0)
    .to('#features .fx-prog', {backgroundColor:'rgba(255,255,255,.14)', ease:'none'}, 0);

    ScrollTrigger.create({
      trigger:'#features', start:'top top', end:'bottom bottom',
      onUpdate:s=>{
        const el = document.getElementById('fxProg');
        if(el) el.style.transform = 'scaleX(' + s.progress + ')';
      }
    });

    }

    /* HOW IT WORKS — vertical scroll becomes horizontal translation */
    const track = document.getElementById('hzTrack');
    if(!track) return;
    const dist  = ()=> Math.max(0, track.scrollWidth - window.innerWidth + 80);

    gsap.to(track,{
      x:()=> -dist(), ease:'none',
      scrollTrigger:{
        trigger:'#steps',
        start:'top top',
        end:()=> '+=' + dist(),
        scrub:true,
        pin:'.hz-stage',
        anticipatePin:1,
        invalidateOnRefresh:true,
        refreshPriority:2,        /* between #features and #apps */
        onUpdate:s=>{
          const el = document.getElementById('hzProg');
          if(el) el.style.transform = 'scaleX(' + s.progress + ')';
        }
      }
    });

    /* the inactive steps dim to focus the current one, but stay clearly
       legible — they must never read as blank */
    gsap.utils.toArray('.hzc').forEach((c,i)=>{
      gsap.fromTo(c,{opacity:.55, scale:.94},{
        opacity:1, scale:1, ease:'none',
        scrollTrigger:{
          trigger:'#steps', start:()=> 'top top-=' + (i * dist() / 5.4),
          end:()=> 'top top-=' + ((i + 1) * dist() / 5.4), scrub:true
        }
      });
    });
  });

  /* ---------- MOBILE ---------- */
  mm.add(MOBILE, ()=>{
    /* No pin, no horizontal track, no scrubbed 3D — the track becomes a
       normal swipeable rail and the cards use plain reveals instead, and
       the product tabs go back to being plain buttons. */
    appsSeek = null;
    gsap.set('#hzTrack',{clearProps:'transform'});
    gsap.utils.toArray('.hzc').forEach(c=>{
      gsap.fromTo(c,{opacity:0, y:30},{opacity:1, y:0, duration:.7, ease:"power3.out", immediateRender:false,
        scrollTrigger:{trigger:c, start:"top 92%", toggleActions:REVEAL}});
    });
    gsap.utils.toArray('.fxc').forEach(c=>{
      gsap.fromTo(c,{opacity:0, y:30},{opacity:1, y:0, duration:.7, ease:"power3.out", immediateRender:false,
        scrollTrigger:{trigger:c, start:"top 94%", toggleActions:REVEAL}});
    });
  });

  /* ==========================================================
     SAFETY NET — nothing may stay invisible while it is on screen.
     ScrollTrigger derives its start positions from layout, so a late
     font swap, an image settling or a jump straight into the middle of
     the page can leave an element parked at its pre-reveal opacity even
     though the reader is looking right at it. Rather than trust the
     measurements, watch the reveal targets and force any element that is
     still transparent a beat after coming into view to its end state.
     ========================================================== */
  const onScreen = new Set();
  const watcher = new IntersectionObserver(entries=>{
    entries.forEach(en=> en.isIntersecting ? onScreen.add(en.target) : onScreen.delete(en.target));
  },{threshold:.1});

  document.querySelectorAll('[data-reveal], .fxc, .hzc, .mini, .inv, .tc, .sus, .strip-c, .ci, .form')
    .forEach(el=>{ if(!el.closest('#hero')) watcher.observe(el); });

  /* The invariant is about where the page comes to REST, so the sweep runs
     every time scrolling stops rather than once per intersection — a reveal
     can also be rewound after it was last observed (scrolling back up over
     its start), and a one-shot check would never look at it again. */
  function sweepStranded(){
    onScreen.forEach(el=>{
      const r = el.getBoundingClientRect();
      if(r.top > window.innerHeight * .95 || r.bottom < window.innerHeight * .05) return;
      if(parseFloat(getComputedStyle(el).opacity) < .25){
        gsap.to(el,{opacity:1, x:0, y:0, filter:'blur(0px)', duration:.35, overwrite:'auto'});
      }
    });
  }
  let sweepTimer;
  window.addEventListener('scroll', ()=>{
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(sweepStranded, 260);
  }, {passive:true});
  setTimeout(sweepStranded, 1200);

  /* fonts land after first paint and shift every trigger start */
  if(document.fonts && document.fonts.ready){
    document.fonts.ready.then(()=> ScrollTrigger.refresh());
  }

  ScrollTrigger.refresh();
}
