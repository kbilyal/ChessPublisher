const tocLinks=[...document.querySelectorAll('.manual-toc a[href^="#"]')];
const sections=tocLinks.map(a=>document.querySelector(a.getAttribute('href'))).filter(Boolean);
if('IntersectionObserver' in window){
  const observer=new IntersectionObserver(entries=>{
    const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
    if(!visible)return;
    tocLinks.forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+visible.target.id));
  },{rootMargin:'-20% 0px -65% 0px',threshold:[0,.15,.35,.6]});
  sections.forEach(s=>observer.observe(s));
}
