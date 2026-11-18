const navToggle=document.querySelector('.nav-toggle');
const nav=document.getElementById('site-nav');
navToggle?.addEventListener('click',()=>{const open=nav.classList.toggle('open');navToggle.setAttribute('aria-expanded',String(open));});
nav?.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{nav.classList.remove('open');navToggle?.setAttribute('aria-expanded','false');}));

document.getElementById('year').textContent=new Date().getFullYear();

const lightbox=document.getElementById('lightbox');
const lightboxImg=lightbox?.querySelector('img');
const openShot=card=>{
  if(!lightbox||!lightboxImg)return;
  const src=card.dataset.lightboxSrc||card.querySelector('img')?.src;
  if(!src)return;
  lightboxImg.src=src;
  lightboxImg.alt=card.querySelector('img')?.alt||'Chess-Publisher screenshot';
  lightbox.showModal();
};
document.querySelectorAll('[data-lightbox-src]').forEach(card=>{
  card.addEventListener('click',e=>{if(e.target.closest('a'))return;openShot(card);});
});
lightbox?.querySelector('.lightbox-close')?.addEventListener('click',()=>lightbox.close());
lightbox?.addEventListener('click',e=>{if(e.target===lightbox)lightbox.close();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&lightbox?.open)lightbox.close();});

// Latest release resolver.
// Priority: public GitHub Releases -> bundled latest.json fallback.
(async()=>{
  // Only resolve GitHub release metadata on pages that actually render release UI.
  if(!document.querySelector('[data-release-version],#installerDownload,#heroDownload'))return;
  const FALLBACK_URL='latest.json';
  const GITHUB_LATEST='https://api.github.com/repos/kbilyal/ChessPublisher/releases/latest';

  const formatDate=value=>{
    if(!value)return '';
    const d=new Date(value);
    if(Number.isNaN(d.getTime()))return value;
    return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(d);
  };
  const bytes=n=>{
    n=Number(n)||0;
    if(!n)return '';
    if(n>=1024*1024)return `${(n/(1024*1024)).toFixed(1)} MB`;
    if(n>=1024)return `${(n/1024).toFixed(0)} KB`;
    return `${n} B`;
  };
  const versionText=v=>{
    v=String(v||'').trim();
    if(!v)return '';
    return /^v/i.test(v)?v:`v${v}`;
  };
  const pickAsset=(assets,kind)=>{
    const list=Array.isArray(assets)?assets:[];
    const name=a=>String(a?.name||'').toLowerCase();
    if(kind==='installer')return list.find(a=>name(a).endsWith('.exe')&&!name(a).includes('sha'))||null;
    if(kind==='portable')return list.find(a=>name(a).endsWith('.zip'))||null;
    if(kind==='checksums')return list.find(a=>/(sha256|checksum)/.test(name(a))&&/\.(txt|sha256)$/.test(name(a)))||null;
    return null;
  };
  const fromGithub=async()=>{
    const r=await fetch(GITHUB_LATEST,{headers:{Accept:'application/vnd.github+json'},cache:'no-store'});
    if(!r.ok)throw new Error(`GitHub release lookup failed: ${r.status}`);
    const rel=await r.json();
    if(rel?.draft||rel?.prerelease)throw new Error('Latest GitHub release is not stable');
    const installer=pickAsset(rel.assets,'installer');
    const portable=pickAsset(rel.assets,'portable');
    const checksums=pickAsset(rel.assets,'checksums');
    if(!installer||!portable)throw new Error('Latest GitHub release is missing required Windows assets');
    return {
      version:String(rel.tag_name||rel.name||'').replace(/^v/i,''),
      displayDate:formatDate(rel.published_at||rel.created_at),
      installer:installer.browser_download_url,
      portable:portable.browser_download_url,
      checksums:checksums?.browser_download_url||'',
      installerSize:bytes(installer.size),
      portableSize:bytes(portable.size),
      external:true
    };
  };
  const fromLocal=async()=>{
    const r=await fetch(FALLBACK_URL,{cache:'no-store'});
    if(!r.ok)throw new Error(`Local release metadata failed: ${r.status}`);
    const info=await r.json();
    return {
      version:info.version,
      displayDate:formatDate(info.date),
      installer:info.installer?.url||info.installer,
      portable:info.portable?.url||info.portable,
      checksums:info.checksums?.url||info.checksums,
      installerSize:bytes(info.installer?.size),
      portableSize:bytes(info.portable?.size),
      external:true
    };
  };
  const apply=info=>{
    if(!info)return;
    const version=versionText(info.version);
    document.querySelectorAll('[data-release-version]').forEach(el=>{if(version)el.textContent=version;});
    document.querySelectorAll('[data-release-date]').forEach(el=>{if(info.displayDate)el.textContent=info.displayDate;});
    const installer=document.getElementById('installerDownload');
    const portable=document.getElementById('portableDownload');
    const checksum=document.getElementById('checksumDownload');
    const hero=document.getElementById('heroDownload');
    if(info.installer){installer?.setAttribute('href',info.installer);hero?.setAttribute('href',info.installer);}
    if(info.portable)portable?.setAttribute('href',info.portable);
    if(info.checksums){checksum?.setAttribute('href',info.checksums);checksum?.removeAttribute('hidden');}
    else checksum?.setAttribute('hidden','');
    if(info.external){installer?.removeAttribute('download');portable?.removeAttribute('download');hero?.removeAttribute('download');}
    document.querySelectorAll('[data-installer-size]').forEach(el=>{if(info.installerSize)el.textContent=info.installerSize;});
    document.querySelectorAll('[data-portable-size]').forEach(el=>{if(info.portableSize)el.textContent=info.portableSize;});
  };
  try{apply(await fromGithub());}
  catch(_){try{apply(await fromLocal());}catch(__){/* keep safe built-in links */}}
})();
