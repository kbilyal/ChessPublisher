(()=>{
  'use strict';
  // Chess-Publisher Website v36 TEST — tournament detail page polish; v35 remains rollback-safe.

  const LIST_URL='tournaments-data.json';
  const API_BASE=(window.CHESS_PUBLISHER_TOURNAMENTS_API||'').replace(/\/$/,'');
  const listEl=document.getElementById('tournamentList');
  const directory=document.getElementById('directoryView');
  const detail=document.getElementById('tournamentDetail');
  const search=document.getElementById('tournamentSearch');
  const summaryEl=document.getElementById('directorySummary');
  const federationDirectoryEl=document.getElementById('federationDirectory');
  const federationSelect=document.getElementById('federationSelect');
  const toastEl=document.getElementById('hubToast');
  const filterButtons=[...document.querySelectorAll('[data-filter]')];

  let tournaments=[];
  let activeFilter='all';
  let activeFederation='';
  let directoryUpdatedAt=null;
  let detailId=null;
  let detailData=null;
  let detailTab='overview';
  let pairingRound=null;
  let detailRefreshTimer=null;
  let directoryRefreshTimer=null;

  const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  // hub-calendar-status-v3: calendar dates override stale API/live round status.
  function hubCalendarDay(value){
    if(!value)return '';
    const raw=String(value).trim();
    let match=/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(raw);
    let year,month,day;
    if(match){[,year,month,day]=match;}
    else {
      match=/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:$|\s)/.exec(raw);
      if(match){day=match[1].padStart(2,'0');month=match[2].padStart(2,'0');year=match[3];}
      else {
        match=/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec(raw);
        if(!match)return '';
        const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const index=months.indexOf(match[2].slice(0,3).toLowerCase());
        if(index<0)return '';
        day=match[1].padStart(2,'0');month=String(index+1).padStart(2,'0');year=match[3];
      }
    }
    const key=year+'-'+month+'-'+day;
    const d=new Date(key+'T12:00:00Z');
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===key?key:'';
  }
  function hubDateRange(value){
    if(typeof value!=='string')return null;
    const raw=value.trim();
    // Accept a two-date range only if both days can be validated.
    const iso=[...raw.matchAll(/\d{4}-\d{2}-\d{2}/g)].map(m=>hubCalendarDay(m[0]));
    if(iso.length===2&&iso.every(Boolean))return {start:iso[0],end:iso[1]};
    const euro=[...raw.matchAll(/\d{1,2}[./]\d{1,2}[./]\d{4}/g)].map(m=>hubCalendarDay(m[0]));
    if(euro.length===2&&euro.every(Boolean))return {start:euro[0],end:euro[1]};
    // Displayed Hub dates can be a human-readable range, e.g.
    // "31 Aug 2026 – 01 Sept 2026", rather than separate ISO fields.
    const human=[...raw.matchAll(/\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b/g)].map(m=>hubCalendarDay(m[0]));
    if(human.length===2&&human.every(Boolean))return {start:human[0],end:human[1]};
    const compact=/^(\d{1,2})\s*[-–]\s*(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(raw);
    if(compact){
      const part=(day)=>hubCalendarDay(day+'.'+compact[3]+'.'+compact[4]);
      const start=part(compact[1]),end=part(compact[2]);
      if(start&&end)return {start,end};
    }
    return null;
  }
  function hubToday(){
    const parts=new Intl.DateTimeFormat('en-GB',{
      timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(new Date());
    const get=type=>parts.find(p=>p.type===type)?.value||'';
    return get('year')+'-'+get('month')+'-'+get('day');
  }
  function hubApplyCalendarStatus(t){
    if(!t||typeof t!=='object')return t;
    const dates=t.dates||t.tournament?.dates||{};
    const pick=(...values)=>values.map(hubCalendarDay).find(Boolean)||'';
    const range=hubDateRange(t.date)||hubDateRange(t.dateRange)||hubDateRange(t.datesText)||hubDateRange(t.scheduleInfo?.dates);
    // Include the exact field used by tournamentDateBlock(), plus API alternatives.
    const start=pick(t.startDate,t.dateFrom,t.fromDate,t.start,dates.start,dates.startDate,t.tournament?.startDate,range?.start,t.date);
    const end=pick(t.endDate,t.dateTo,t.toDate,t.end,dates.end,dates.endDate,t.tournament?.endDate,range?.end,t.date)||start;
    if(!start&&!end)return t; // Unknown dates: never invent a lifecycle.
    if(start&&end&&end<start)return t; // Contradictory calendar values.
    const today=hubToday();
    if(end&&today>end)t.status='completed';
    else if(start&&today<start)t.status='upcoming';
    else if(start&&end)t.status='live';
    return t;
  }
  const statusLabel=status=>({live:'Live',upcoming:'Upcoming',completed:'Completed',published:'Published'}[String(status||'').toLowerCase()]||'Published');
  function federationName(federation){
    const fed=fedCode(federation);
    if(!fed)return 'Unknown federation';
    if(fed==='FID'||fed==='FIDE')return 'FIDE';
    const iso2=federationIso2(fed);
    if(!iso2)return fed;
    try{
      const names=new Intl.DisplayNames(['en'],{type:'region'});
      return names.of(iso2)||fed;
    }catch(_){return fed;}
  }
  function federationKey(value){return fedCode(value)||'FID';}
  const formatPoints=value=>Number.isFinite(Number(value))?Number(value).toFixed(1):esc(value||'0.0');
  const hasValue=value=>value!==null&&value!==undefined&&String(value).trim()!=='';
  const isFinishedResult=value=>{const v=String(value??'').trim();return v&&v!=='-'&&v!=='*';};

  const FED_TO_ISO2=Object.freeze({"ABW":"AW","AFG":"AF","AGO":"AO","AIA":"AI","ALA":"AX","ALB":"AL","AND":"AD","ARE":"AE","ARG":"AR","ARM":"AM","ASM":"AS","ATA":"AQ","ATF":"TF","ATG":"AG","AUS":"AU","AUT":"AT","AZE":"AZ","BDI":"BI","BEL":"BE","BEN":"BJ","BES":"BQ","BFA":"BF","BGD":"BD","BGR":"BG","BHR":"BH","BHS":"BS","BIH":"BA","BLM":"BL","BLR":"BY","BLZ":"BZ","BMU":"BM","BOL":"BO","BRA":"BR","BRB":"BB","BRN":"BH","BTN":"BT","BVT":"BV","BWA":"BW","CAF":"CF","CAN":"CA","CCK":"CC","CHE":"CH","CHL":"CL","CHN":"CN","CIV":"CI","CMR":"CM","COD":"CD","COG":"CG","COK":"CK","COL":"CO","COM":"KM","CPV":"CV","CRI":"CR","CUB":"CU","CUW":"CW","CXR":"CX","CYM":"KY","CYP":"CY","CZE":"CZ","DEU":"DE","DJI":"DJ","DMA":"DM","DNK":"DK","DOM":"DO","DZA":"DZ","ECU":"EC","EGY":"EG","ERI":"ER","ESH":"EH","ESP":"ES","EST":"EE","ETH":"ET","FIN":"FI","FJI":"FJ","FLK":"FK","FRA":"FR","FRO":"FO","FSM":"FM","GAB":"GA","GBR":"GB","GEO":"GE","GGY":"GG","GHA":"GH","GIB":"GI","GIN":"GN","GLP":"GP","GMB":"GM","GNB":"GW","GNQ":"GQ","GRC":"GR","GRD":"GD","GRL":"GL","GTM":"GT","GUF":"GF","GUM":"GU","GUY":"GY","HKG":"HK","HMD":"HM","HND":"HN","HRV":"HR","HTI":"HT","HUN":"HU","IDN":"ID","IMN":"IM","IND":"IN","IOT":"IO","IRL":"IE","IRN":"IR","IRQ":"IQ","ISL":"IS","ISR":"IL","ITA":"IT","JAM":"JM","JEY":"JE","JOR":"JO","JPN":"JP","KAZ":"KZ","KEN":"KE","KGZ":"KG","KHM":"KH","KIR":"KI","KNA":"KN","KOR":"KR","KWT":"KW","LAO":"LA","LBN":"LB","LBR":"LR","LBY":"LY","LCA":"LC","LIE":"LI","LKA":"LK","LSO":"LS","LTU":"LT","LUX":"LU","LVA":"LV","MAC":"MO","MAF":"MF","MAR":"MA","MCO":"MC","MDA":"MD","MDG":"MG","MDV":"MV","MEX":"MX","MHL":"MH","MKD":"MK","MLI":"ML","MLT":"MT","MMR":"MM","MNE":"ME","MNG":"MN","MNP":"MP","MOZ":"MZ","MRT":"MR","MSR":"MS","MTQ":"MQ","MUS":"MU","MWI":"MW","MYS":"MY","MYT":"YT","NAM":"NA","NCL":"NC","NER":"NE","NFK":"NF","NGA":"NG","NIC":"NI","NIU":"NU","NLD":"NL","NOR":"NO","NPL":"NP","NRU":"NR","NZL":"NZ","OMN":"OM","PAK":"PK","PAN":"PA","PCN":"PN","PER":"PE","PHL":"PH","PLW":"PW","PNG":"PG","POL":"PL","PRI":"PR","PRK":"KP","PRT":"PT","PRY":"PY","PSE":"PS","PYF":"PF","QAT":"QA","REU":"RE","ROU":"RO","RUS":"RU","RWA":"RW","SAU":"SA","SDN":"SD","SEN":"SN","SGP":"SG","SGS":"GS","SHN":"SH","SJM":"SJ","SLB":"SB","SLE":"SL","SLV":"SV","SMR":"SM","SOM":"SO","SPM":"PM","SRB":"RS","SSD":"SS","STP":"ST","SUR":"SR","SVK":"SK","SVN":"SI","SWE":"SE","SWZ":"SZ","SXM":"SX","SYC":"SC","SYR":"SY","TCA":"TC","TCD":"TD","TGO":"TG","THA":"TH","TJK":"TJ","TKL":"TK","TKM":"TM","TLS":"TL","TON":"TO","TTO":"TT","TUN":"TN","TUR":"TR","TUV":"TV","TWN":"TW","TZA":"TZ","UGA":"UG","UKR":"UA","UMI":"UM","URY":"UY","USA":"US","UZB":"UZ","VAT":"VA","VCT":"VC","VEN":"VE","VGB":"VG","VIR":"VI","VNM":"VN","VUT":"VU","WLF":"WF","WSM":"WS","YEM":"YE","ZAF":"ZA","ZMB":"ZM","ZWE":"ZW","BAN":"BD","BAR":"BB","BER":"BM","BIZ":"BZ","BOT":"BW","BRU":"BN","CAM":"KH","CRC":"CR","DEN":"DK","ENG":"GB","ESA":"SV","FIJ":"FJ","GEQ":"GQ","GER":"DE","INA":"ID","IRI":"IR","JCI":"JE","KOS":"XK","KSA":"SA","KUW":"KW","LAT":"LV","LIB":"LB","MAS":"MY","MNC":"MC","MRI":"MU","MYA":"MM","NED":"NL","NGR":"NG","NIR":"GB","PHI":"PH","PLE":"PS","POR":"PT","PUR":"PR","RSA":"ZA","SCO":"GB","SRI":"LK","SUD":"SD","SUI":"CH","TAN":"TZ","TPE":"TW","UAE":"AE","URU":"UY","VIE":"VN","WLS":"GB","ZAM":"ZM","ZIM":"ZW"});
  const FED_FLAG_OVERRIDE=Object.freeze({ENG:'🏴',SCO:'🏴',WLS:'🏴',NIR:'🇬🇧',FID:'🏳️',KOS:'🇽🇰'});
  const FIDE_TO_ISO2=Object.freeze({ALG:'DZ',ANG:'AO',ANT:'AG',ARU:'AW',BAH:'BS',BAN:'BD',BAR:'BB',BER:'BM',BHU:'BT',BIZ:'BZ',BOT:'BW',BRN:'BH',BRU:'BN',BUL:'BG',BUR:'BF',CAM:'KH',CAY:'KY',CAR:'CF',CHA:'TD',CHI:'CL',CRC:'CR',CRO:'HR',DEN:'DK',ENG:'GB',ESA:'SV',FAI:'FO',FIJ:'FJ',GAM:'GM',GCI:'GG',GEQ:'GQ',GER:'DE',GRE:'GR',GUA:'GT',HAI:'HT',HON:'HN',INA:'ID',IRI:'IR',ISV:'VI',IVB:'VG',JCI:'JE',KOS:'XK',KSA:'SA',KUW:'KW',LAT:'LV',LBA:'LY',LES:'LS',MAD:'MG',MAS:'MY',MAW:'MW',MGL:'MN',MNC:'MC',MRI:'MU',MTN:'MR',MYA:'MM',NCA:'NI',NED:'NL',NEP:'NP',NGR:'NG',NIR:'GB',OMA:'OM',PAR:'PY',PHI:'PH',PLE:'PS',POR:'PT',PUR:'PR',RSA:'ZA',SCO:'GB',SEY:'SC',SLO:'SI',SOL:'SB',SRI:'LK',SUD:'SD',SUI:'CH',TAN:'TZ',TOG:'TG',URU:'UY',VIE:'VN',WLS:'GB',ZAM:'ZM',ZIM:'ZW'});

  function fedCode(value){
    const code=String(value||'FID').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(code)?code:'FID';
  }

  // Directory filters need a real empty state. Do not pass an empty selector/URL
  // value through fedCode(), because fedCode() intentionally falls back to FID
  // for missing tournament/player federation data.
  function federationFilterCode(value){
    const raw=String(value??'').trim().toUpperCase();
    if(!raw||raw==='ALL')return '';
    if(raw==='FIDE')return 'FID';
    return /^[A-Z]{3}$/.test(raw)?raw:'';
  }

  function federationIso2(federation){
    const fed=fedCode(federation);
    return FIDE_TO_ISO2[fed]||FED_TO_ISO2[fed]||'';
  }

  function flagEmoji(federation){
    const fed=fedCode(federation);
    if(FED_FLAG_OVERRIDE[fed])return FED_FLAG_OVERRIDE[fed];
    const iso2=federationIso2(fed);
    if(!iso2||!/^[A-Z]{2}$/.test(iso2))return '🌐';
    return [...iso2].map(ch=>String.fromCodePoint(127397+ch.charCodeAt(0))).join('');
  }

  function flagImage(federation,extraClass=''){
    const fed=fedCode(federation);
    const iso2=federationIso2(fed);
    if(!iso2)return `<span class="fed-flag-fallback ${esc(extraClass)}" aria-hidden="true">${flagEmoji(fed)}</span>`;
    const code=iso2.toLowerCase();
    return `<img class="fed-flag-img ${esc(extraClass)}" src="https://flagcdn.com/w40/${code}.png" srcset="https://flagcdn.com/w80/${code}.png 2x" width="24" height="18" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="${esc(fed)} flag" onerror="this.onerror=null;this.removeAttribute(\'srcset\');this.src=\'data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"40\" height=\"30\" viewBox=\"0 0 40 30\"><rect width=\"40\" height=\"30\" rx=\"3\" fill=\"#eef3f8\"/><text x=\"20\" y=\"19\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" font-size=\"10\" font-weight=\"700\" fill=\"#4a6075\">${fed}</text></svg>`) }\'">`;
  }

  function federationBadge(federation,extraClass=''){
    const fed=fedCode(federation);
    return `<span class="fed-badge ${esc(extraClass)}">${flagImage(fed)}<span>${esc(fed)}</span></span>`;
  }

  function federationInline(federation){
    const fed=fedCode(federation);
    return `<span class="player-fed-inline">${flagImage(fed,'fed-flag-inline')}<span>${esc(fed)}</span></span>`;
  }

  function formatBytes(value){
    const n=Number(value);
    if(!Number.isFinite(n)||n<0)return '';
    if(n<1024)return `${Math.round(n)} B`;
    if(n<1024*1024)return `${(n/1024).toFixed(n<10*1024?1:0)} KB`;
    return `${(n/(1024*1024)).toFixed(n<10*1024*1024?1:0)} MB`;
  }

  function preformatted(value){
    return `<div class="unicode-text">${esc(value||'')}</div>`;
  }

  function hrefFromValue(value){
    const text=String(value??'').trim();
    if(!text)return '';
    if(/^https?:\/\//i.test(text))return text;
    if(/^mailto:/i.test(text))return text;
    if(/^tel:/i.test(text))return text;
    if(text.includes('@')&&!/\s/.test(text))return `mailto:${text}`;
    if(/^\+?[\d()\-\s]{5,}$/.test(text))return `tel:${text.replace(/\s+/g,'')}`;
    return '';
  }

  function linkOrText(value,label){
    const text=String(value??'').trim();
    if(!text)return '';
    const href=hrefFromValue(text);
    return href?`<a href="${esc(href)}" target="${href.startsWith('http')?'_blank':'_self'}" rel="noopener">${esc(label||text)}${href.startsWith('http')?' ↗':''}</a>`:`<span>${esc(label||text)}</span>`;
  }

  function googleMapsSearchUrl(value){
    const text=String(value??'').trim();
    return text?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`:'';
  }

  function locationLink(value){
    const text=String(value??'').trim();
    if(!text)return '';
    return `<a class="maps-location-link" href="${esc(googleMapsSearchUrl(text))}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">⌖</span>${esc(text)}<span aria-hidden="true">↗</span></a>`;
  }

  function normalizeContactItems(data){
    const out=[];
    const add=(label,value)=>{
      if(!hasValue(value))return;
      const text=String(value).trim();
      if(out.some(item=>item.label===label&&item.value===text))return;
      out.push({label,value:text});
    };
    const buckets=[data?.contact,data?.contacts,data?.contactInfo,data?.publicContact,data?.organizer,data?.organizerContact,data?.registration?.contact,data?.registration?.contacts];
    buckets.forEach(bucket=>{
      if(Array.isArray(bucket)){
        bucket.forEach(entry=>{
          if(typeof entry==='string')add('Contact',entry);
          else if(entry&&typeof entry==='object'){
            add(entry.label||entry.type||entry.role||'Contact',entry.value||entry.text||entry.name||entry.email||entry.phone||entry.url||entry.telegram);
          }
        });
      }else if(bucket&&typeof bucket==='object'){
        add('Contact person',bucket.name||bucket.person||bucket.contactPerson);
        add('Email',bucket.email);
        add('Phone',bucket.phone||bucket.mobile||bucket.tel);
        add('Website',bucket.website||bucket.url);
        add('Telegram',bucket.telegram);
        add('Address',bucket.address);
      }
    });
    add('Email',data?.email);
    add('Phone',data?.phone);
    add('Website',data?.website||data?.url);
    return out;
  }

  function normalizeAttachmentItems(data){
    const out=[];
    const pushItem=(name,url,size,contentType)=>{
      if(!hasValue(name)&&!hasValue(url))return;
      const key=`${name||''}|${url||''}`;
      if(out.some(item=>item.key===key))return;
      out.push({key,name:String(name||'Attachment'),url:url?String(url):'',size,contentType});
    };
    const collect=(bucket)=>{
      if(!bucket)return;
      if(Array.isArray(bucket)){bucket.forEach(collect);return;}
      if(typeof bucket==='string'){pushItem(bucket,'');return;}
      if(typeof bucket==='object'){
        pushItem(bucket.name||bucket.title||bucket.fileName||bucket.filename,bucket.url||bucket.href||bucket.downloadUrl||bucket.link,bucket.size,bucket.contentType||bucket.mimeType);
      }
    };
    collect(data?.attachments);
    collect(data?.files);
    collect(data?.documents);
    collect(data?.publicFiles);
    const regAttachment=data?.regulations?.attachment;
    if(regAttachment&&typeof regAttachment==='object'){
      const fallbackUrl=regAttachment.url||regAttachment.href||regAttachment.downloadUrl||regAttachment.link||(API_BASE&&detailId?`${API_BASE}/tournaments/${encodeURIComponent(detailId)}/regulations-file`:'');
      pushItem(regAttachment.name||regAttachment.title||regAttachment.fileName||regAttachment.filename||'Tournament regulations',fallbackUrl,regAttachment.size,regAttachment.contentType||regAttachment.mimeType);
    }
    return out;
  }

  function registrationSummaryItems(data){
    const reg=data?.registration&&typeof data.registration==='object'?data.registration:{};
    const sched=data?.scheduleInfo&&typeof data.scheduleInfo==='object'?data.scheduleInfo:{};
    const rules=data?.regulations&&typeof data.regulations==='object'?data.regulations:{};
    const pairs=[
      ['Registration opens',reg.opens||reg.open||reg.registrationOpens||sched.registrationOpens],
      ['Registration closes',reg.closes||reg.close||reg.deadline||reg.registrationCloses||sched.registrationCloses],
      ['Entry fee',reg.entryFee||rules.entryFee],
      ['Maximum players',reg.maximumPlayers||rules.maximumPlayers],
      ['Registration note',reg.notes||reg.note||rules.registrationNote]
    ];
    return pairs.filter(([,value])=>hasValue(value)).map(([label,value])=>({label,value:String(value)}));
  }

  function headerInfoSection(title,items,{kind='text'}={}){
    if(!items.length)return '';
    const rows=items.map(item=>{
      if(kind==='attachments'){
        const meta=[item.contentType,formatBytes(item.size)].filter(Boolean).map(esc).join(' · ');
        const main=item.url?`<a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.name)} ↗</a>`:`<span>${esc(item.name)}</span>`;
        return `<li><span>${esc(item.label||'File')}</span><strong>${main}</strong>${meta?`<small>${meta}</small>`:''}</li>`;
      }
      const main=kind==='contact'?linkOrText(item.value,item.value):kind==='location'?locationLink(item.value):`<span>${esc(item.value)}</span>`;
      return `<li><span>${esc(item.label)}</span><strong>${main}</strong></li>`;
    }).join('');
    return `<article class="detail-info-card"><div class="detail-info-card-head"><span class="section-kicker">Tournament info</span><h3>${esc(title)}</h3></div><ul class="detail-info-list">${rows}</ul></article>`;
  }

  function headerExtraSections(data){
    const locationItems=hasValue(data?.location)?[{label:'Location',value:String(data.location)}]:[];
    const sections=[
      headerInfoSection('Location',locationItems,{kind:'location'}),
      headerInfoSection('Registration',registrationSummaryItems(data)),
      headerInfoSection('Contact',normalizeContactItems(data),{kind:'contact'}),
      headerInfoSection('📎 Attached files',normalizeAttachmentItems(data).map(item=>({...item,label:'File'})),{kind:'attachments'})
    ].filter(Boolean);
    if(!sections.length)return '';
    return `<div class="detail-extra-grid">${sections.join('')}</div>`;
  }

  function showToast(message){
    if(!toastEl)return;
    toastEl.textContent=message;
    toastEl.hidden=false;
    clearTimeout(showToast.timer);
    showToast.timer=setTimeout(()=>{toastEl.hidden=true;},2200);
  }

  function safeDate(value){
    if(!value)return null;
    const d=new Date(value);
    return Number.isNaN(d.getTime())?null:d;
  }

  function relativeTime(value){
    const d=safeDate(value);
    if(!d)return 'Update time unavailable';
    const seconds=Math.round((d.getTime()-Date.now())/1000);
    const abs=Math.abs(seconds);
    let unit='second',amount=seconds;
    if(abs>=86400){unit='day';amount=Math.round(seconds/86400);}
    else if(abs>=3600){unit='hour';amount=Math.round(seconds/3600);}
    else if(abs>=60){unit='minute';amount=Math.round(seconds/60);}
    try{return new Intl.RelativeTimeFormat('en',{numeric:'auto'}).format(amount,unit);}
    catch(_){return d.toLocaleString();}
  }

  function exactTime(value){
    const d=safeDate(value);
    if(!d)return '';
    try{return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);}
    catch(_){return d.toLocaleString();}
  }


  function logDateTime(value){
    const d=safeDate(value);
    if(!d)return '—';
    try{return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d).replace(',', '');}
    catch(_){return d.toLocaleString();}
  }

  function logDateOnly(value){
    const d=safeDate(value);
    if(!d)return '';
    try{return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d);}
    catch(_){return d.toLocaleDateString();}
  }

  function tournamentDateBlock(t){
    const start=t.startDate||t.dateFrom||t.fromDate||t.start||t.date;
    const end=t.endDate||t.dateTo||t.toDate||t.end||t.date;
    const startText=logDateOnly(start);
    const endText=logDateOnly(end);
    if(startText&&endText&&startText!==endText)return `${startText}<span>${endText}</span>`;
    if(startText)return `${startText}`;
    return esc(t.date||'—');
  }

  function roundsText(t){
    const current=Number(t.currentRound);
    const total=t.rounds;
    if(hasValue(total)&&Number.isFinite(current)&&current>0)return `${esc(current)} / ${esc(total)}`;
    if(hasValue(total))return esc(total);
    return '—';
  }

  function propertyBadges(t){
    const badges=[];
    const pairingsCount=Object.keys(t.pairings||{}).length;
    const hasSchedule=Array.isArray(t.schedule)&&t.schedule.length||Object.keys(t.scheduleInfo||{}).length;
    const hasRegulations=!!(t.regulations&&Object.keys(t.regulations).some(key=>hasValue(t.regulations[key])||(Array.isArray(t.regulations[key])&&t.regulations[key].length)));
    const hasAttachments=!!((Array.isArray(t.attachments)&&t.attachments.length)||(Array.isArray(t.files)&&t.files.length)||(Array.isArray(t.documents)&&t.documents.length)||(t.regulations&&t.regulations.attachment));
    if(pairingsCount)badges.push('<span class="log-prop" title="Pairings / results published">♟</span>');
    if(hasSchedule)badges.push('<span class="log-prop" title="Schedule published">◷</span>');
    if(hasRegulations)badges.push('<span class="log-prop" title="Regulations published">📄</span>');
    if(hasAttachments)badges.push('<span class="log-prop" title="Attached files available">📎</span>');
    badges.push(`<span class="log-prop status-mark status-${statusClass(t.status)}" title="${esc(statusLabel(t.status))}">${statusClass(t.status)==='live'?'●':statusClass(t.status)==='upcoming'?'◔':'◌'}</span>`);
    return badges.join('');
  }

  function statusClass(status){
    const s=String(status||'published').toLowerCase();
    return ['live','upcoming','completed'].includes(s)?s:'published';
  }

  async function fetchJson(url){
    const r=await fetch(url,{cache:'no-store',headers:{Accept:'application/json'}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function loadDirectory({silent=false}={}){
    try{
      const source=API_BASE?`${API_BASE}/tournaments`:LIST_URL;
      const payload=await fetchJson(source);
      tournaments=(Array.isArray(payload)?payload:(payload.tournaments||[])).map(hubApplyCalendarStatus);
      directoryUpdatedAt=payload?.updatedAt||new Date().toISOString();
    }catch(_){
      if(!silent)tournaments=[];
    }
    renderDirectory();
  }

  function federationCounts(items){
    const map=new Map();
    for(const t of items){
      const fed=federationKey(t.federation);
      const current=map.get(fed)||{code:fed,name:federationName(fed),count:0};
      current.count+=1;
      map.set(fed,current);
    }
    return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.code.localeCompare(b.code));
  }

  function syncFederationFromUrl(){
    const params=new URLSearchParams(location.search);
    if(params.get('id'))return;
    activeFederation=federationFilterCode(params.get('fed'));
  }

  function updateFederationUrl(fed){
    const url=new URL(location.href);
    url.searchParams.delete('id');
    if(fed)url.searchParams.set('fed',fed);else url.searchParams.delete('fed');
    history.replaceState(null,'',url.pathname+(url.search||''));
  }

  function renderFederationDirectory(baseItems){
    const federations=federationCounts(baseItems);
    if(federationSelect){
      const current=activeFederation;
      federationSelect.innerHTML='<option value="">All federations</option>'+federations.map(f=>`<option value="${esc(f.code)}">${esc(f.name)} (${esc(f.code)}) · ${f.count}</option>`).join('');
      federationSelect.value=federations.some(f=>f.code===current)?current:'';
    }
    if(federationDirectoryEl)federationDirectoryEl.innerHTML='';
  }

  function renderTournamentCard(t){
    const status=statusClass(t.status);
    const locationLabel=t.location&&/^https?:\/\//i.test(String(t.locationUrl||''))
      ? `<a href="${esc(t.locationUrl)}" target="_blank" rel="noopener">${esc(t.location)} ↗</a>`
      : esc(t.location||'—');
    const nameLine=t.name||'Untitled tournament';
    const subline=[federationBadge(t.federation,'fed-badge-log'), t.format?`<span>${esc(t.format)}</span>`:'', t.timeControl?`<span>${esc(t.timeControl)}</span>`:''].filter(Boolean).join('<span class="log-dot">•</span>');
    return `<a class="tournament-log-row status-${status}" href="/tournaments?id=${encodeURIComponent(t.id||t.slug)}">
      <div class="log-cell log-updated"><strong>${esc(logDateTime(t.updatedAt))}</strong></div>
      <div class="log-cell log-dates"><strong>${tournamentDateBlock(t)}</strong></div>
      <div class="log-cell log-name"><strong>${esc(nameLine)}</strong><small>${subline}</small></div>
      <div class="log-cell log-location"><strong>${locationLabel}</strong></div>
      <div class="log-cell log-players"><strong>${esc(t.playerCount??t.players?.length??'—')}</strong></div>
      <div class="log-cell log-rounds"><strong>${roundsText(t)}</strong></div>
      <div class="log-cell log-properties">${propertyBadges(t)}<span class="log-open" aria-hidden="true">→</span></div>
    </a>`;
  }

  function tournamentUpdatedValue(t){
    const value=Date.parse(t?.updatedAt||t?.lastUpdatedAt||t?.publishedAt||t?.createdAt||'');
    return Number.isFinite(value)?value:0;
  }

  function compareTournamentRecency(a,b){
    return tournamentUpdatedValue(b)-tournamentUpdatedValue(a)||String(a?.name||'').localeCompare(String(b?.name||''));
  }

  function renderDirectory(){
    if(!listEl)return;
    const q=(search?.value||'').trim().toLowerCase();
    const statusBase=tournaments.filter(t=>activeFilter==='all'||String(t.status||'').toLowerCase()===activeFilter);
    renderFederationDirectory(statusBase);
    const shown=statusBase.filter(t=>{
      const fedOk=!activeFederation||federationKey(t.federation)===activeFederation;
      const hay=[t.name,t.location,t.federation,federationName(t.federation),t.format,t.timeControl].join(' ').toLowerCase();
      return fedOk&&(!q||hay.includes(q));
    }).sort(compareTournamentRecency);

    if(summaryEl){
      const live=tournaments.filter(t=>String(t.status).toLowerCase()==='live').length;
      const label=`${shown.length} ${shown.length===1?'tournament':'tournaments'}`;
      const fedLabel=activeFederation?` · ${federationName(activeFederation)} (${activeFederation})`:'';
      summaryEl.innerHTML=`<div><strong>${label}${esc(fedLabel)}</strong>${live?`<span class="summary-live"><i></i>${live} live</span>`:''}</div><span title="${esc(exactTime(directoryUpdatedAt))}">Directory updated ${esc(relativeTime(directoryUpdatedAt))}</span>`;
    }

    if(!shown.length){
      listEl.innerHTML=`<div class="empty-tournaments"><div class="empty-tournaments-icon">♜</div><h3>${tournaments.length?'No tournaments match this selection.':'No public tournaments yet.'}</h3><p>${tournaments.length?'Try another federation, search or status filter.':'Published Chess-Publisher Hub tournaments will appear here automatically.'}</p><div class="empty-actions"><button class="button button-primary" type="button" data-clear-federation-empty>All federations</button><a class="button button-secondary" href="index.html#download">Get Chess-Publisher</a></div></div>`;
      listEl.querySelector('[data-clear-federation-empty]')?.addEventListener('click',()=>{activeFederation='';updateFederationUrl('');renderDirectory();});
      return;
    }

    listEl.innerHTML=`<div class="tournament-log"><div class="tournament-log-head"><div>Updated at</div><div>Dates</div><div>Tournament</div><div>Location</div><div>Players</div><div>Rounds</div><div>Properties</div></div><div class="tournament-log-body">${shown.map(renderTournamentCard).join('')}</div></div>`;
  }

  async function loadTournament(id,{silent=false,preserve=true}={}){
    detailId=id;
    document.body.classList.add('tournament-detail-mode');
    directory.hidden=true;
    detail.hidden=false;
    if(!silent)detail.innerHTML=loadingState();
    try{
      const data=await fetchJson(API_BASE?`${API_BASE}/tournaments/${encodeURIComponent(id)}`:`tournaments/${encodeURIComponent(id)}.json`);
      hubApplyCalendarStatus(data);
      detailData=data;
      if(!preserve){detailTab='overview';pairingRound=null;}
      renderTournament(data);
      scheduleDetailRefresh(data);
    }catch(error){
      if(!silent){
        detail.innerHTML='<a class="detail-back" href="/tournaments">← All tournaments</a><div class="detail-error"><div class="detail-error-icon">!</div><h2>Tournament not found</h2><p>This public tournament is unavailable or has not been published yet.</p><a class="button button-primary" href="/tournaments">Back to tournaments</a></div>';
      }
    }
  }

  function loadingState(){
    return `<div class="detail-loading"><div class="skeleton skeleton-short"></div><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-line"></div><div class="skeleton-grid"><i></i><i></i><i></i><i></i></div></div>`;
  }

  function standings(data){
    const list=[...(data.players||[])];
    if(list.some(p=>Number.isFinite(Number(p.rank))&&Number(p.rank)>0))return list.sort((a,b)=>(Number(a.rank)||99999)-(Number(b.rank)||99999));
    return list.sort((a,b)=>(Number(b.points)||0)-(Number(a.points)||0)||(Number(b.rating)||0)-(Number(a.rating)||0));
  }

  function playerName(p){return p?.title?`${p.title} ${p.name||''}`:(p?.name||'');}

  function fideIdLink(id,label='FIDE ID'){
    const value=String(id??'').trim();
    if(!value)return '';
    return `<a class="fide-id-link" href="https://ratings.fide.com/profile/${encodeURIComponent(value)}" target="_blank" rel="noopener noreferrer">${label?`${esc(label)} `:''}<b>${esc(value)}</b><span aria-hidden="true">↗</span></a>`;
  }

  function playerButton(p,{showFederation=false}={}){
    if(!p||!p.key||String(p.name||'').toUpperCase()==='BYE')return `<span class="plain-player-name">${esc(playerName(p)||'BYE')}</span>`;
    return `<button class="player-link" type="button" data-player-key="${esc(p.key)}">${esc(playerName(p))}${showFederation?` <span class="player-inline-fed">${flagEmoji(p.federation)} ${esc(fedCode(p.federation))}</span>`:''}</button>`;
  }

  function resultForPlayer(raw,isWhite){
    const r=String(raw??'').trim();
    const u=r.toUpperCase().replace(/\s+/g,'');
    if(!r||r==='-'||r==='*')return {label:'—',score:null,kind:'pending'};
    if(['1-0','1:0'].includes(u))return {label:isWhite?'1':'0',score:isWhite?1:0,kind:isWhite?'win':'loss'};
    if(['0-1','0:1'].includes(u))return {label:isWhite?'0':'1',score:isWhite?0:1,kind:isWhite?'loss':'win'};
    if(['1/2-1/2','½-½','0.5-0.5'].includes(u))return {label:'½',score:.5,kind:'draw'};
    if(['PAB','1BYE','1BYE.'].includes(u))return {label:'1 BYE',score:1,kind:'bye'};
    if(['½BYE','1/2BYE','0.5BYE'].includes(u))return {label:'½ BYE',score:.5,kind:'bye'};
    if(['0BYE'].includes(u))return {label:'0 BYE',score:0,kind:'bye'};
    return {label:r,score:null,kind:'other'};
  }

  function playerRoundHistory(data,player){
    const rounds=Object.keys(data.pairings||{}).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
    const history=[];
    for(const round of rounds){
      const pairs=data.pairings?.[String(round)]||[];
      const pair=pairs.find(item=>item.white?.key===player.key||item.black?.key===player.key);
      if(!pair)continue;
      const isWhite=pair.white?.key===player.key;
      const opponent=isWhite?pair.black:pair.white;
      history.push({round,board:pair.board,color:isWhite?'White':'Black',opponent,result:resultForPlayer(pair.result,isWhite),rawResult:pair.result});
    }
    return history;
  }

  function signedRating(value,digits=0){
    const n=Number(value);
    if(!Number.isFinite(n))return '—';
    const abs=Math.abs(n).toFixed(digits);
    if(Math.abs(n)<Math.pow(10,-digits)/2)return digits?Number(0).toFixed(digits):'0';
    return `${n>0?'+':'−'}${abs}`;
  }

  function scoreText(score,games){
    if(!Number.isFinite(Number(score))||!Number.isFinite(Number(games))||Number(games)<=0)return '—';
    const s=Number(score);
    return `${Number.isInteger(s)?s:s.toFixed(1)} / ${Number(games)}`;
  }

  function ratingRuleUrl(type){
    return type==='standard'?'https://handbook.fide.com/chapter/B022024':'https://handbook.fide.com/chapter/B02RBRegulations2024';
  }

  function ratingAnalysisPanel(analysis){
    if(!analysis)return '';
    const source=ratingRuleUrl(analysis.type);
    const warnings=(analysis.warnings||[]).map(text=>`<li>${esc(text)}</li>`).join('');
    if(analysis.mode==='rated'){
      const changeClass=analysis.roundedChange>0?'is-positive':analysis.roundedChange<0?'is-negative':'is-neutral';
      const kAssumed=analysis.k?.source==='assumed';
      const kLabel=analysis.k?`K ${esc(analysis.k.effective)}${analysis.k.effective!==analysis.k.base?` <span>(base ${esc(analysis.k.base)})</span>`:''}`:'K —';
      return `<section class="fide-rating-panel" aria-label="FIDE rating impact">
        <div class="fide-rating-top">
          <div><span class="fide-rating-kicker">FIDE rating impact · ${esc(analysis.typeLabel)}</span><div class="fide-rating-projection"><strong>${esc(analysis.currentRating)}</strong><i aria-hidden="true">→</i><strong>${esc(analysis.estimatedNewRating)}</strong></div><small>Tournament-only estimate${kAssumed?' · official K not present in Hub snapshot':''}</small></div>
          <div class="fide-rating-change ${changeClass}"><span>Rating Δ</span><strong>${signedRating(analysis.roundedChange)}</strong></div>
        </div>
        <div class="fide-rating-metrics">
          <div><span>Rated games</span><strong>${esc(analysis.ratedGames)}</strong></div>
          <div><span>Score</span><strong>${esc(scoreText(analysis.score,analysis.ratedGames))}</strong></div>
          <div><span>ARO</span><strong>${analysis.aro!==null?esc(Math.round(analysis.aro)):'—'}</strong></div>
          <div><span>Performance</span><strong>${analysis.performance!==null?esc(analysis.performance):'—'}</strong></div>
          <div><span>K factor</span><strong>${kLabel}</strong></div>
        </div>
        <details class="fide-rating-details"><summary>How this FIDE estimate is calculated</summary><div class="fide-rating-details-body"><p>Only played games against rated opponents are included. For each rated game the FIDE scoring-probability table is used, then <b>ΔR = score − PD</b> and the tournament sum is multiplied by K. The displayed new rating assumes no other rated games alter the same rating period.</p>${warnings?`<ul>${warnings}</ul>`:''}<a href="${source}" target="_blank" rel="noopener">Official FIDE rating regulations ↗</a></div></details>
      </section>`;
    }

    const hasInitial=Number.isFinite(Number(analysis.initialRating));
    const publication=analysis.publishable?'Publication minimum met in this tournament':'Provisional · tournament data only';
    return `<section class="fide-rating-panel fide-initial-panel" aria-label="FIDE initial rating estimate">
      <div class="fide-rating-top">
        <div><span class="fide-rating-kicker">FIDE initial rating · ${esc(analysis.typeLabel)}</span><div class="fide-initial-value"><strong>${hasInitial?esc(analysis.initialRating):'—'}</strong><span>Estimated Ru</span></div><small>${esc(publication)}</small></div>
        <div class="fide-initial-progress"><span>Qualifying games</span><strong>${esc(analysis.ratedGames)} / 5</strong><i><b style="width:${Math.min(100,(Number(analysis.ratedGames)||0)/5*100)}%"></b></i></div>
      </div>
      ${hasInitial?`<div class="fide-rating-metrics fide-initial-metrics">
        <div><span>Rated opponents</span><strong>${esc(analysis.ratedGames)}</strong></div>
        <div><span>Score</span><strong>${esc(scoreText(analysis.score,analysis.ratedGames))}</strong></div>
        <div><span>Actual ARO</span><strong>${analysis.aro!==null?esc(Math.round(analysis.aro)):'—'}</strong></div>
        <div><span>Ra incl. dummy</span><strong>${esc(Math.round(analysis.ra))}</strong></div>
        <div><span>dp</span><strong>${signedRating(analysis.dp)}</strong></div>
      </div>
      <div class="fide-dummy-row"><span class="fide-dummy-icon" aria-hidden="true">＋</span><div><strong>FIDE hypothetical-opponent adjustment</strong><span>2 × 1800-rated opponents · draw against each · used only in the initial-rating calculation</span></div></div>`:''}
      <details class="fide-rating-details"><summary>How the FIDE initial rating is calculated</summary><div class="fide-rating-details-body"><p>FIDE adds two hypothetical opponents rated 1800 and treats both results as draws. Their ratings and the two half-points are included when calculating <b>Ra</b> and the score percentage, then <b>Ru = Ra + dp</b>. Ru is rounded to the nearest whole number and capped at 2200.</p>${warnings?`<ul>${warnings}</ul>`:''}<a href="${source}" target="_blank" rel="noopener">Official FIDE rating regulations ↗</a></div></details>
    </section>`;
  }

  function ratingHistoryCell(game,analysis){
    if(!game||!analysis)return '<span class="fide-not-rated">—</span>';
    if(!game.ratingEligible)return `<span class="fide-not-rated" title="${esc(game.exclusionReason||'Not included in FIDE rating calculation')}">Not rated</span>`;
    if(analysis.mode==='initial')return `<span class="fide-counts" title="Counts toward the provisional initial-rating calculation">Counts</span>`;
    const points=Number(game.ratingPoints);
    const cls=points>0?'is-positive':points<0?'is-negative':'is-neutral';
    const expected=Number.isFinite(Number(game.pd))?`Expected score ${Number(game.pd).toFixed(2)}`:'Rated game';
    return `<span class="fide-game-delta ${cls}" title="${esc(expected)}">${signedRating(points,1)}</span>`;
  }

  function ensurePlayerModal(){
    let modal=document.getElementById('playerHistoryModal');
    if(modal)return modal;
    modal=document.createElement('div');
    modal.id='playerHistoryModal';
    modal.className='player-modal-backdrop';
    modal.hidden=true;
    modal.innerHTML='<section class="player-modal" role="dialog" aria-modal="true" aria-labelledby="playerModalTitle"><button class="player-modal-close" type="button" aria-label="Close player history">×</button><div id="playerModalContent"></div></section>';
    document.body.appendChild(modal);
    modal.querySelector('.player-modal-close').addEventListener('click',closePlayerModal);
    modal.addEventListener('click',event=>{if(event.target===modal)closePlayerModal();});
    return modal;
  }

  function closePlayerModal(){
    const modal=document.getElementById('playerHistoryModal');
    if(!modal)return;
    modal.hidden=true;
    document.body.classList.remove('player-modal-open');
  }

  function openPlayerModal(data,key){
    const player=(data.players||[]).find(p=>String(p.key)===String(key));
    if(!player)return;
    const modal=ensurePlayerModal();
    const content=document.getElementById('playerModalContent');
    const history=playerRoundHistory(data,player);
    const ratingAnalysis=window.ChessPublisherRating?.analyseTournament?.(data,player,history)||null;
    const wins=history.filter(x=>x.result.kind==='win').length;
    const draws=history.filter(x=>x.result.kind==='draw').length;
    const losses=history.filter(x=>x.result.kind==='loss').length;
    const byes=history.filter(x=>x.result.kind==='bye').length;
    const rows=history.length?history.map((item,index)=>{
      const opp=item.opponent||{};
      const oppName=String(opp.name||'BYE');
      const ratingGame=ratingAnalysis?.games?.[index]||null;
      return `<tr><td>${esc(item.round)}</td><td>${esc(item.board||'—')}</td><td><span class="color-chip color-${item.color.toLowerCase()}">${esc(item.color)}</span></td><td class="player-history-opponent">${opp.key?playerButton(opp):esc(oppName)}${oppName.toUpperCase()!=='BYE'?`<span>${federationBadge(opp.federation,'fed-badge-mini')} ${Number(opp.rating)>0?esc(opp.rating):'Unrated'}</span>`:''}</td><td><span class="history-result history-${esc(item.result.kind)}">${esc(item.result.label)}</span></td><td>${ratingHistoryCell(ratingGame,ratingAnalysis)}</td></tr>`;
    }).join(''):'<tr><td colspan="6" class="player-history-empty">No published games yet.</td></tr>';
    content.innerHTML=`
      <div class="player-modal-head">
        <div class="player-modal-identity"><div class="player-modal-flag">${flagImage(player.federation,'fed-flag-modal-image')}</div><div><span class="section-kicker">Player tournament history</span><h2 id="playerModalTitle">${esc(playerName(player))}</h2><p>${federationBadge(player.federation,'fed-badge-modal')} ${Number(player.rating)>0?`<span>Rating <b>${esc(player.rating)}</b></span>`:'<span>Unrated</span>'}${player.fideId?`<span>${fideIdLink(player.fideId)}</span>`:''}</p></div></div>
        <div class="player-modal-rank"><span>Rank</span><strong>${esc(player.rank||'—')}</strong><small>${formatPoints(player.points)} pts</small></div>
      </div>
      <div class="player-modal-stats"><div><span>Wins</span><strong>${wins}</strong></div><div><span>Draws</span><strong>${draws}</strong></div><div><span>Losses</span><strong>${losses}</strong></div><div><span>Byes</span><strong>${byes}</strong></div>${player.joinedFromRound&&Number(player.joinedFromRound)>1?`<div><span>Joined</span><strong>R${esc(player.joinedFromRound)}</strong></div>`:''}</div>
      ${ratingAnalysisPanel(ratingAnalysis)}
      <div class="player-history-table-wrap"><table class="player-history-table"><thead><tr><th>Rnd</th><th>Board</th><th>Color</th><th>Opponent</th><th>Result</th><th>FIDE</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    content.querySelectorAll('[data-player-key]').forEach(btn=>btn.addEventListener('click',event=>{event.preventDefault();openPlayerModal(data,btn.dataset.playerKey);}));
    modal.hidden=false;
    document.body.classList.add('player-modal-open');
    modal.querySelector('.player-modal-close')?.focus();
  }

  function tableSearch(label,placeholder,targetId){
    return `<label class="table-search"><span aria-hidden="true">⌕</span><input type="search" data-table-search="${esc(targetId)}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}"></label>`;
  }

  function playerTable(players){
    if(!players.length)return emptyPanel('No players published','The starting list is not available yet.');
    const rows=players.map(p=>`<tr data-search-row="${esc([playerName(p),p.federation,p.rating,p.startNo,p.fideId].join(' ').toLowerCase())}"><td class="rank-cell">${esc(p.startNo||p.rank||'')}</td><td class="player-cell"><strong>${playerButton(p)}</strong><span>${p.fideId?fideIdLink(p.fideId):`Starting rank ${esc(p.startNo||'—')}`}</span></td><td>${federationBadge(p.federation)}</td><td class="num rating-cell">${Number(p.rating)>0?esc(p.rating):'Unrated'}</td><td class="num points-cell">${formatPoints(p.points)}</td></tr>`).join('');
    const cards=players.map(p=>`<div class="mobile-standing-card" data-search-row="${esc([playerName(p),p.federation,p.rating,p.startNo,p.fideId].join(' ').toLowerCase())}"><strong>${esc(p.startNo||p.rank||'')}</strong><div class="mobile-standing-name"><strong>${playerButton(p)}</strong><span>${federationInline(p.federation)} · ${Number(p.rating)>0?esc(p.rating):'Unrated'}${p.fideId?` · ${fideIdLink(p.fideId,'FIDE')}`:''}</span></div><div class="mobile-standing-points"><strong>${formatPoints(p.points)}</strong><span>pts</span></div></div>`).join('');
    return `${startingListSummary(players)}<div class="panel-heading"><div><h2>Starting list</h2><p>${players.length} registered ${players.length===1?'player':'players'} · click a player for tournament history</p></div>${tableSearch('Search starting list','Search player','players')}</div><div id="players"><div class="hub-table-wrap desktop-table"><table class="hub-table"><thead><tr><th>No.</th><th>Player</th><th>Fed.</th><th class="num">Rating</th><th class="num">Pts</th></tr></thead><tbody>${rows}</tbody></table></div><div class="mobile-standings">${cards}</div><div class="table-empty" hidden>No players match this search.</div></div>`;
  }

  function shortTieBreakLabel(label,index){
    const raw=String(label||'').trim();
    const matches=[...raw.matchAll(/\(([A-Z0-9][A-Z0-9+\-./]{1,11})\)/g)];
    if(matches.length)return matches[matches.length-1][1];
    const clean=raw.replace(/\s*\[\d+\]\s*$/,'').trim();
    if(clean.length<=12)return clean||`TB${index+1}`;
    return `TB${index+1}`;
  }

  function tieBreakValue(player,index){
    const values=Array.isArray(player?.tieBreakValues)?player.tieBreakValues:[];
    if(index<values.length&&hasValue(values[index]))return values[index];
    if(index===0&&hasValue(player?.tieBreak))return player.tieBreak;
    return '—';
  }

  function standingsTable(players,data){
    if(!players.length)return emptyPanel('No standings published','Standings will appear after tournament results are available.');
    const tieBreaks=Array.isArray(data?.tieBreaks)&&data.tieBreaks.length?data.tieBreaks:[{key:'tb-1',label:data?.tieBreakLabel||'TB'}];
    const tieHeaders=tieBreaks.map((tb,index)=>`<th class="num tiebreak-col" title="${esc(tb.label||`TB${index+1}`)}">${esc(shortTieBreakLabel(tb.label,index))}</th>`).join('');
    const rows=players.map(p=>{
      const tieCells=tieBreaks.map((tb,index)=>`<td class="num tiebreak-value" title="${esc(tb.label||`TB${index+1}`)}">${esc(tieBreakValue(p,index))}</td>`).join('');
      return `<tr data-search-row="${esc([playerName(p),p.federation,p.rating,p.rank].join(' ').toLowerCase())}"><td class="rank-cell"><span class="rank-badge rank-${Number(p.rank)<=3?Number(p.rank):'other'}">${esc(p.rank||'—')}</span></td><td class="player-cell"><strong>${playerButton(p)}</strong><span>${federationInline(p.federation)} · Start No. ${esc(p.startNo||'—')}</span></td><td class="num rating-cell">${Number(p.rating)>0?esc(p.rating):'—'}</td><td class="num points-cell">${formatPoints(p.points)}</td>${tieCells}</tr>`;
    }).join('');
    const cards=players.map(p=>{
      const tieMeta=tieBreaks.map((tb,index)=>`<span title="${esc(tb.label||`TB${index+1}`)}"><b>${esc(shortTieBreakLabel(tb.label,index))}</b> ${esc(tieBreakValue(p,index))}</span>`).join('');
      return `<div class="mobile-standing-card" data-search-row="${esc([playerName(p),p.federation,p.rating,p.rank].join(' ').toLowerCase())}"><strong>${esc(p.rank||'—')}</strong><div class="mobile-standing-name"><strong>${playerButton(p)}</strong><span>${federationInline(p.federation)} · ${Number(p.rating)>0?esc(p.rating):'Unrated'}</span><div class="mobile-tiebreaks">${tieMeta}</div></div><div class="mobile-standing-points"><strong>${formatPoints(p.points)}</strong><span>pts</span></div></div>`;
    }).join('');
    return `<div class="panel-heading"><div><h2>Standings</h2><p>${data.currentRound?`After round ${esc(data.currentRound)}`:'Latest published ranking'} · all published tie-breaks · click a player for history</p></div>${tableSearch('Search standings','Search player','standings')}</div><div id="standings"><div class="hub-table-wrap desktop-table standings-scroll"><table class="hub-table standings-table"><thead><tr><th>Rank</th><th>Player</th><th class="num">Rating</th><th class="num">Pts</th>${tieHeaders}</tr></thead><tbody>${rows}</tbody></table></div><div class="mobile-standings">${cards}</div><div class="table-empty" hidden>No players match this search.</div></div>`;
  }

  function pairingSearchText(pair){
    return [
      pair?.board,
      playerName(pair?.white),pair?.white?.federation,pair?.white?.rating,pair?.white?.fideId,
      playerName(pair?.black),pair?.black?.federation,pair?.black?.rating,pair?.black?.fideId,
      pair?.result
    ].filter(hasValue).join(' ').toLowerCase();
  }

  function pairingsView(data,round){
    const pairs=data.pairings?.[String(round)]||[];
    if(!pairs.length)return emptyPanel('No pairings published','This round has no public pairing data yet.');
    const playerMeta=p=>String(p?.name||'').toUpperCase()==='BYE'?'BYE':`${federationInline(p?.federation)} · ${Number(p?.rating)>0?esc(p.rating):'Unrated'}`;
    const desktop=`<div class="hub-table-wrap desktop-table"><table class="hub-table pairing-table"><thead><tr><th>Board</th><th>White</th><th class="num">Pts</th><th>Black</th><th class="num">Pts</th><th class="num">Result</th></tr></thead><tbody>${pairs.map(p=>`<tr data-search-row="${esc(pairingSearchText(p))}"><td class="board-cell">${esc(p.board)}</td><td class="player-cell"><strong>${playerButton(p.white)}</strong><span>${playerMeta(p.white)}</span></td><td class="num">${formatPoints(p.white?.points)}</td><td class="player-cell"><strong>${playerButton(p.black)}</strong><span>${playerMeta(p.black)}</span></td><td class="num">${formatPoints(p.black?.points)}</td><td class="num"><span class="result-chip ${isFinishedResult(p.result)?'is-final':''}">${esc(p.result||'—')}</span></td></tr>`).join('')}</tbody></table></div>`;
    const mobile=`<div class="mobile-pairings">${pairs.map(p=>`<div class="mobile-pairing-card" data-search-row="${esc(pairingSearchText(p))}"><div class="mobile-pairing-head"><span>Board ${esc(p.board)}</span><span class="result-chip ${isFinishedResult(p.result)?'is-final':''}">${esc(p.result||'—')}</span></div><div class="mobile-pairing-player"><div><strong><i class="piece-dot white"></i>${playerButton(p.white)}</strong><span>${playerMeta(p.white)} · ${formatPoints(p.white?.points)} pts</span></div></div><div class="mobile-pairing-player"><div><strong><i class="piece-dot black"></i>${playerButton(p.black)}</strong><span>${playerMeta(p.black)} · ${formatPoints(p.black?.points)} pts</span></div></div></div>`).join('')}</div>`;
    return desktop+mobile+'<div class="table-empty" hidden>No pairings match this search.</div>';
  }

  function emptyPanel(title,message){
    return `<div class="detail-error compact"><div class="detail-error-icon">♙</div><h2>${esc(title)}</h2><p>${esc(message)}</p></div>`;
  }

  function eventInfoRows(data){
    const rows=[
      ['Location',data.location],
      ['Date',data.date],
      ['Time control',data.timeControl],
      ['Pairing system',data.pairingSystem||data.format],
      ['Federation',data.federation],
      ['Updated',data.updatedAt?exactTime(data.updatedAt):null]
    ].filter(([,value])=>hasValue(value));
    return rows.map(([label,value])=>`<div><span>${esc(label)}</span><strong>${label==='Federation'?federationBadge(value,'fed-badge-event'):label==='Location'?locationLink(value):esc(value)}</strong></div>`).join('');
  }

  function currentRoundProgress(data){
    const round=Number(data.currentRound)||Math.max(0,...Object.keys(data.pairings||{}).map(Number).filter(Number.isFinite));
    const pairs=data.pairings?.[String(round)]||[];
    if(!round||!pairs.length)return '—';
    const finished=pairs.filter(p=>isFinishedResult(p.result)).length;
    return `${finished}/${pairs.length}`;
  }

  function latestRoundCard(data){
    const round=Number(data.currentRound)||Math.max(0,...Object.keys(data.pairings||{}).map(Number).filter(Number.isFinite));
    const pairs=data.pairings?.[String(round)]||[];
    if(!round||!pairs.length)return '';
    const finished=pairs.filter(p=>isFinishedResult(p.result)).length;
    return `<article class="overview-card round-overview-card"><div class="overview-card-title"><div><span class="section-kicker">Latest round</span><h2>Round ${esc(round)}</h2></div><span class="round-progress">${finished}/${pairs.length} results</span></div><div class="mini-board-list">${pairs.slice(0,5).map(p=>`<div><b>${esc(p.board)}</b><span>${playerButton(p.white)} <em>vs</em> ${playerButton(p.black)}</span><strong>${esc(p.result||'—')}</strong></div>`).join('')}</div>${pairs.length>5?`<button class="text-action" type="button" data-go-tab="pairings">View all ${pairs.length} boards →</button>`:''}</article>`;
  }

  function overview(data){
    const leaders=standings(data).slice(0,5);
    const topStandings=leaders.length?leaders.map(p=>`<div class="leader-row"><b>${esc(p.rank||'—')}</b><div class="leader-name"><strong>${playerButton(p)}</strong><span>${federationInline(p.federation)} · ${Number(p.rating)>0?esc(p.rating):'Unrated'}</span></div><div class="leader-points">${formatPoints(p.points)}</div></div>`).join(''):'<div class="overview-empty">Standings are not available yet.</div>';
    return `<div class="overview-grid"><div class="overview-stat"><span>Players</span><strong>${esc(data.playerCount??data.players?.length??0)}</strong></div><div class="overview-stat"><span>Rounds</span><strong>${esc(data.rounds||'—')}</strong></div><div class="overview-stat"><span>Current round</span><strong>${esc(data.currentRound||'—')}</strong></div><div class="overview-stat"><span>Round results</span><strong>${esc(currentRoundProgress(data))}</strong><small>boards finished</small></div></div><div class="overview-main"><article class="overview-card"><div class="overview-card-title"><div><span class="section-kicker">Ranking</span><h2>Top standings</h2></div><button class="text-action" type="button" data-go-tab="standings">Full standings →</button></div><div class="leader-list">${topStandings}</div></article><article class="overview-card"><div class="overview-card-title"><div><span class="section-kicker">Tournament</span><h2>Event information</h2></div></div><div class="event-info-list">${eventInfoRows(data)}</div></article>${latestRoundCard(data)}</div>`;
  }

  function scheduleTime(value){
    const d=safeDate(value);
    if(!d)return '—';
    try{return new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);}
    catch(_){return d.toLocaleString();}
  }

  function scheduleRowForRound(data,round){
    const target=Number(round);
    if(!Number.isInteger(target)||target<1)return null;
    const rows=Array.isArray(data?.schedule)?data.schedule:[];
    return rows.find(row=>{
      const match=String(row?.event||'').trim().match(/^Round\s+(\d+)$/i);
      return match&&Number(match[1])===target;
    })||null;
  }

  function pairingScheduleCard(data,round){
    const row=scheduleRowForRound(data,round);
    if(!row)return '';
    const current=Number(data?.currentRound)||0;
    const status=round<current?'Completed':round===current&&String(data?.status||'').toLowerCase()==='live'?'Current round':'Scheduled';
    return `<section class="pairing-schedule-card" aria-label="Round ${esc(round)} schedule"><div class="pairing-schedule-icon" aria-hidden="true">◷</div><div class="pairing-schedule-main"><span class="section-kicker">Tournament schedule · Round ${esc(round)}</span><strong>${esc(scheduleTime(row.dateTime))}</strong>${hasValue(row.description)?`<p>${esc(row.description)}</p>`:''}</div><span class="pairing-schedule-status status-${status==='Current round'?'current':status.toLowerCase()}">${esc(status)}</span></section>`;
  }

  function scheduleView(data){
    const rows=Array.isArray(data.schedule)?data.schedule:[];
    const meta=data.scheduleInfo&&typeof data.scheduleInfo==='object'?data.scheduleInfo:{};
    const keyEvents=[
      ['Registration opens',meta.registrationOpens],['Registration closes',meta.registrationCloses],['Technical meeting',meta.technicalMeeting],['Opening ceremony',meta.openingCeremony],['Closing ceremony',meta.closingCeremony],['Award ceremony',meta.awardCeremony]
    ].filter(([,value])=>hasValue(value));
    if(!rows.length&&!keyEvents.length&&!hasValue(meta.notes))return emptyPanel('No schedule published','The organizer has not published the tournament schedule yet.');
    const keyHtml=keyEvents.length?`<div class="schedule-key-grid">${keyEvents.map(([label,value])=>`<div><span>${esc(label)}</span><strong>${esc(scheduleTime(value))}</strong></div>`).join('')}</div>`:'';
    const table=rows.length?`<div class="schedule-table-wrap"><table class="schedule-public-table"><thead><tr><th>No.</th><th>Date & time</th><th>Event</th><th>Notes / schedule</th></tr></thead><tbody>${rows.map((row,index)=>`<tr><td>${esc(row.no||index+1)}</td><td><time>${esc(scheduleTime(row.dateTime))}</time></td><td><strong>${esc(row.event||'—')}</strong></td><td>${hasValue(row.description)?preformatted(row.description):'—'}</td></tr>`).join('')}</tbody></table></div>`:'';
    return `<div class="panel-heading"><div><span class="section-kicker">Tournament program</span><h2>Schedule</h2><p>Published directly from Chess-Publisher.</p></div></div>${keyHtml}${table}${hasValue(meta.notes)?`<article class="public-text-card"><span class="section-kicker">Schedule notes</span>${preformatted(meta.notes)}</article>`:''}`;
  }

  function regulationItem(label,value,{multiline=false}={}){
    if(!hasValue(value))return '';
    return `<div class="regulation-item"><span>${esc(label)}</span>${multiline?preformatted(value):`<strong>${esc(value)}</strong>`}</div>`;
  }

  function regulationsView(data){
    const r=data.regulations&&typeof data.regulations==='object'?data.regulations:{};
    const tieBreaks=Array.isArray(r.tieBreaks)?r.tieBreaks.filter(hasValue):[];
    const attachment=r.attachment&&typeof r.attachment==='object'?r.attachment:null;
    const core=[
      regulationItem('Eligibility',r.eligibility,{multiline:true}),regulationItem('Rating',r.rating),regulationItem('Default time',r.defaultTime),regulationItem('Draw rules',r.drawRules,{multiline:true}),regulationItem('Entry fee',r.entryFee),regulationItem('Registration deadline',r.registrationDeadline?scheduleTime(r.registrationDeadline):''),regulationItem('Maximum players',r.maximumPlayers),regulationItem('FIDE information',r.fideInfo,{multiline:true})
    ].filter(Boolean).join('');
    const prizes=[regulationItem('Total prize fund',r.totalPrizeFund),regulationItem('Main prizes',r.mainPrizes,{multiline:true}),regulationItem('Special prizes',r.specialPrizes,{multiline:true}),regulationItem('Age / category prizes',r.categoryPrizes,{multiline:true})].filter(Boolean).join('');
    const any=core||prizes||tieBreaks.length||hasValue(r.additional)||attachment;
    if(!any)return emptyPanel('No regulations published','Tournament regulations have not been published from Chess-Publisher yet.');
    const fileUrl=attachment&&API_BASE&&detailId?`${API_BASE}/tournaments/${encodeURIComponent(detailId)}/regulations-file`:'';
    const fileCard=attachment?`<article class="regulations-file-card"><div class="regulations-file-icon">📄</div><div><span class="section-kicker">Official file</span><strong>${esc(attachment.name||'Tournament regulations')}</strong><small>${[attachment.contentType,formatBytes(attachment.size)].filter(Boolean).map(esc).join(' · ')}</small></div>${fileUrl?`<a class="button button-secondary regulations-download" href="${esc(fileUrl)}">Download</a>`:''}</article>`:'';
    return `<div class="panel-heading"><div><span class="section-kicker">Published by organizer</span><h2>Regulations</h2><p>Unicode text, Cyrillic and emoji are preserved exactly as published.</p></div></div>${fileCard}${core?`<section class="regulations-section"><h3>General regulations</h3><div class="regulations-grid">${core}</div></section>`:''}${tieBreaks.length?`<section class="regulations-section"><h3>Tie-break criteria</h3><div class="tiebreak-chips">${tieBreaks.map((tb,index)=>`<span><b>${index+1}</b>${esc(tb)}</span>`).join('')}</div></section>`:''}${prizes?`<section class="regulations-section"><h3>Prizes</h3><div class="regulations-grid">${prizes}</div></section>`:''}${hasValue(r.additional)?`<section class="regulations-section"><h3>Additional regulations</h3>${preformatted(r.additional)}</section>`:''}`;
  }

  function availableRounds(data){
    return Object.keys(data.pairings||{}).map(Number).filter(Number.isFinite).sort((a,b)=>b-a);
  }

  function roundSelector(rounds,selected,kind){
    if(!rounds.length)return '';
    return `<div class="round-pills" aria-label="Round selection">${rounds.map(r=>`<button class="round-pill ${r===selected?'active':''}" type="button" data-${kind}-round="${r}" aria-pressed="${r===selected?'true':'false'}">${r}</button>`).join('')}</div>`;
  }

  function renderPanel(data){
    const panel=document.getElementById('detailPanel');
    if(!panel)return;
    const tabs=[...detail.querySelectorAll('[data-tab]')];
    tabs.forEach(b=>{const active=b.dataset.tab===detailTab;b.classList.toggle('active',active);b.setAttribute('aria-selected',active?'true':'false');});

    if(detailTab==='overview')panel.innerHTML=playerTable(data.players||[]);
    if(detailTab==='players')panel.innerHTML=playerTable(data.players||[]);
    if(detailTab==='standings')panel.innerHTML=standingsTable(standings(data),data);
    if(detailTab==='pairings'){
      const rounds=availableRounds(data);
      if(!rounds.length){panel.innerHTML=emptyPanel('No pairings published','Pairings will appear here when a round is published.');}
      else{
        if(!pairingRound||!rounds.includes(pairingRound))pairingRound=rounds.includes(Number(data.currentRound))?Number(data.currentRound):rounds[0];
        const roundPairs=data.pairings?.[String(pairingRound)]||[];
        const finished=roundPairs.filter(p=>isFinishedResult(p.result)).length;
        const pending=Math.max(0,roundPairs.length-finished);
        panel.innerHTML=`<div class="pairing-round-select"><div><span class="section-kicker">Pairings &amp; results</span><h2>Pairings · Round ${esc(pairingRound)}</h2><p class="pairing-round-meta"><strong>${finished}/${roundPairs.length}</strong> completed${pending?` · ${pending} pending`:''} · results update in this view</p></div>${roundSelector(rounds,pairingRound,'pairing')}</div>${pairingScheduleCard(data,pairingRound)}<div class="pairings-search-row">${tableSearch('Search pairings','Search player, board, federation or result','pairings')}</div><div id="pairings">${pairingsView(data,pairingRound)}</div>`;
      }
    }
    if(detailTab==='schedule')panel.innerHTML=scheduleView(data);
    if(detailTab==='regulations')panel.innerHTML=regulationsView(data);

    bindPanelEvents(data);
  }

  function bindPanelEvents(data){
    detail.querySelectorAll('[data-pairing-round]').forEach(btn=>btn.addEventListener('click',()=>{pairingRound=Number(btn.dataset.pairingRound);renderPanel(data);}));
    detail.querySelectorAll('[data-go-tab]').forEach(btn=>btn.addEventListener('click',()=>{detailTab=btn.dataset.goTab;renderPanel(data);scrollTabsIntoView();}));
    detail.querySelectorAll('[data-table-search]').forEach(input=>input.addEventListener('input',()=>filterTable(input)));
    detail.querySelectorAll('[data-player-key]').forEach(btn=>btn.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();openPlayerModal(data,btn.dataset.playerKey);}));
  }

  function filterTable(input){
    const target=document.getElementById(input.dataset.tableSearch);
    if(!target)return;
    const q=input.value.trim().toLowerCase();
    const rows=[...target.querySelectorAll('[data-search-row]')];
    let visible=0;
    rows.forEach(row=>{const match=!q||String(row.dataset.searchRow||'').includes(q);row.hidden=!match;if(match)visible++;});
    const empty=target.querySelector('.table-empty');
    if(empty)empty.hidden=visible!==0;
  }

  function scrollTabsIntoView(){
    const active=detail.querySelector('.detail-tab.active');
    active?.scrollIntoView?.({behavior:'smooth',block:'nearest',inline:'center'});
  }


  function eventDisplayParts(data){
    const raw=String(data?.name||'').trim();
    const parts=raw.split(/\s+\|\s+/).filter(Boolean);
    if(parts.length>1)return {title:parts.shift(),subtitle:parts.join(' · ')};
    return {title:raw,subtitle:''};
  }

  function normalizedPrizeFund(data){
    const direct=data?.prizeFund||data?.totalPrizeFund||data?.regulations?.totalPrizeFund;
    if(hasValue(direct))return String(direct).trim();
    const raw=String(data?.name||'');
    const match=raw.match(/(?:^|[|•·\s])((?:€|EUR\s*)?\d[\d .,'’]*\s*(?:EUR|€))(?:\s+(?:PRIZE\s+FUND|НАГРАДЕН\s+ФОНД))?/i);
    return match?match[1].replace(/\s+/g,' ').trim():'';
  }

  function headerBadges(data,subtitle){
    const candidates=[];
    const prize=normalizedPrizeFund(data);
    if(hasValue(data?.format))candidates.push({text:String(data.format),kind:'format'});
    if(hasValue(data?.timeControl))candidates.push({text:String(data.timeControl),kind:'time'});
    if(prize)candidates.push({text:`🏆 ${prize} prize fund`,kind:'prize'});
    if(data?.fideRated===true||String(data?.fideRated||'').toLowerCase()==='yes')candidates.push({text:'FIDE rated',kind:'fide'});
    if(subtitle){
      const chunks=subtitle.split(/\s*[•·]\s*/).map(x=>x.trim()).filter(Boolean);
      chunks.forEach(text=>{
        const lower=text.toLowerCase();
        if(candidates.some(x=>lower.includes(String(x.text).toLowerCase())||String(x.text).toLowerCase().includes(lower)))return;
        if(/prize|награден|eur|€/.test(lower))return;
        if(/rapid|blitz|standard|classical/.test(lower)&&candidates.some(x=>x.kind==='format'))return;
        candidates.push({text,kind:'context'});
      });
    }
    return candidates.slice(0,6).map(item=>`<span class="event-chip event-chip-${esc(item.kind)}">${esc(item.text)}</span>`).join('');
  }

  function smartRoundBox(data){
    const status=statusClass(data.status);
    const current=Number(data.currentRound)||0;
    const total=Number(data.rounds)||0;
    if(status==='completed')return `<div class="detail-round detail-round-smart"><span>Status</span><strong>FINAL</strong><small>${total?`${esc(total)} / ${esc(total)} rounds`:'Completed'}</small></div>`;
    if(status==='live')return `<div class="detail-round detail-round-smart"><span>Current round</span><strong>${esc(current||'—')} / ${esc(total||'—')}</strong><small>Live tournament</small></div>`;
    if(status==='upcoming')return `<div class="detail-round detail-round-smart"><span>Tournament</span><strong>${total?`${esc(total)} ROUNDS`:'UPCOMING'}</strong><small>${esc(data.date||'Published')}</small></div>`;
    return `<div class="detail-round detail-round-smart"><span>Rounds</span><strong>${esc(current||'—')} / ${esc(total||'—')}</strong><small>${esc(statusLabel(data.status))}</small></div>`;
  }

  function startingListSummary(players){
    const list=Array.isArray(players)?players:[];
    if(!list.length)return '';
    const rated=list.filter(p=>Number(p.rating)>0);
    const avg=rated.length?Math.round(rated.reduce((sum,p)=>sum+Number(p.rating),0)/rated.length):null;
    const feds=new Set(list.map(p=>fedCode(p.federation)).filter(Boolean));
    const titled=list.filter(p=>hasValue(p.title)&&String(p.title).trim()!=='-').length;
    const items=[
      `<div><span>Players</span><strong>${esc(list.length)}</strong></div>`,
      titled?`<div><span>Titled</span><strong>${esc(titled)}</strong></div>`:'',
      feds.size?`<div><span>Federations</span><strong>${esc(feds.size)}</strong></div>`:'',
      avg?`<div><span>Avg rating</span><strong>${esc(avg)}</strong></div>`:''
    ].filter(Boolean).join('');
    return `<div class="starting-summary">${items}</div>`;
  }

  function tabLabelData(data){
    const players=data.playerCount??data.players?.length??0;
    const rounds=availableRounds(data);
    const scheduleCount=Array.isArray(data.schedule)?data.schedule.length:0;
    const hasRegs=!!(data.regulations&&Object.keys(data.regulations).some(k=>hasValue(data.regulations[k])||(Array.isArray(data.regulations[k])&&data.regulations[k].length)));
    return {
      starting:`Starting list <span class="tab-count">${esc(players)}</span>`,
      pairings:`Pairings${rounds.length?` <span class="tab-count">R${esc(Number(data.currentRound)||rounds[0])}</span>`:''}`,
      standings:'Standings',
      schedule:`Schedule${scheduleCount?` <span class="tab-count">${esc(scheduleCount)}</span>`:''}`,
      regulations:`Regulations${hasRegs?'<span class="tab-dot" title="Published"></span>':''}`
    };
  }

  function detailStatusText(data){
    if(data.status==='live')return `Round ${data.currentRound||'—'} in progress`;
    if(data.status==='completed')return 'Tournament completed';
    if(data.status==='upcoming')return 'Tournament published';
    return 'Public tournament';
  }

  function renderTournament(data){
    const status=statusClass(data.status);
    const updated=relativeTime(data.updatedAt);
    const exact=exactTime(data.updatedAt);
    const players=data.playerCount??data.players?.length??0;
    const display=eventDisplayParts(data);
    const tabs=tabLabelData(data);

    detail.innerHTML=`
      <div class="detail-toolbar">
        <a class="detail-back" href="/tournaments">← All tournaments</a>
        <div class="detail-toolbar-right">
          <span class="detail-updated" title="${esc(exact)}"><i class="sync-dot ${status==='live'?'live':''}"></i>Updated ${esc(updated)}</span>
          <button class="detail-action" type="button" id="refreshTournament" title="Refresh tournament data"><span aria-hidden="true">↻</span> Refresh</button>
          <button class="detail-action" type="button" id="shareTournament" title="Copy tournament link"><span aria-hidden="true">↗</span> Share</button>
        </div>
      </div>
      <section class="detail-header status-theme-${status}">
        <div class="detail-header-main">
          <div>
            <div class="detail-status-row"><span class="status-badge status-${status}">${status==='live'?'<i class="status-pulse"></i>':''}${esc(statusLabel(data.status))}</span><span class="detail-status-text">${esc(detailStatusText(data))}</span></div>
            <h1>${esc(display.title||data.name)}</h1>
            ${display.subtitle?`<p class="detail-event-subtitle">${esc(display.subtitle)}</p>`:''}
            <div class="detail-event-context">${hasValue(data.location)?locationLink(data.location):''}${hasValue(data.location)&&hasValue(data.date)?' <span class="meta-separator">·</span> ':''}${hasValue(data.date)?`<span>${esc(data.date)}</span>`:''}</div>
            <div class="event-chips">${headerBadges(data,display.subtitle)}</div>
          </div>
          ${smartRoundBox(data)}
        </div>
        <div class="detail-meta-grid">
          <div><span>Players</span><strong>${esc(players)}</strong></div>
          <div><span>Format</span><strong>${esc(data.format||'—')}</strong></div>
          <div><span>Time control</span><strong>${esc(data.timeControl||'—')}</strong></div>
          <div><span>Federation</span><strong>${federationBadge(data.federation,'fed-badge-header')}</strong></div>
        </div>
        ${headerExtraSections(data)}
      </section>
      <div class="detail-tabs-wrap"><nav class="detail-tabs" role="tablist" aria-label="Tournament views">
        <button class="detail-tab" type="button" role="tab" data-tab="overview">${tabs.starting}</button>
        <button class="detail-tab" type="button" role="tab" data-tab="pairings">${tabs.pairings}</button>
        <button class="detail-tab" type="button" role="tab" data-tab="standings">${tabs.standings}</button>
        <button class="detail-tab" type="button" role="tab" data-tab="schedule">${tabs.schedule}</button>
        <button class="detail-tab" type="button" role="tab" data-tab="regulations">${tabs.regulations}</button>
      </nav></div>
      <div class="detail-panel" id="detailPanel" role="tabpanel"></div>
      <div class="detail-footnote"><span>Revision ${esc(data.revision??'—')}</span><span>Public read-only view · Chess-Publisher Hub</span></div>`;

    detail.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{detailTab=btn.dataset.tab;renderPanel(data);}));
    document.getElementById('refreshTournament')?.addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;button.classList.add('is-loading');
      await loadTournament(detailId,{silent:true,preserve:true});
      showToast('Tournament refreshed');
    });
    document.getElementById('shareTournament')?.addEventListener('click',shareTournament);
    renderPanel(data);
    updateDocumentMeta(data);
  }

  async function shareTournament(){
    const url=location.href;
    const title=detailData?.name||'Chess-Publisher tournament';
    if(navigator.share){
      try{await navigator.share({title,url});return;}catch(error){if(error?.name==='AbortError')return;}
    }
    try{await navigator.clipboard.writeText(url);showToast('Tournament link copied');}
    catch(_){showToast('Copy the link from your browser address bar');}
  }

  function updateDocumentMeta(data){
    document.title=`${data.name} — Chess-Publisher`;
    const description=[statusLabel(data.status),data.location,data.date,`${data.playerCount??data.players?.length??0} players`].filter(Boolean).join(' · ');
    const meta=document.querySelector('meta[name="description"]');if(meta)meta.setAttribute('content',description);
    const ogTitle=document.querySelector('meta[property="og:title"]');if(ogTitle)ogTitle.setAttribute('content',`${data.name} — Chess-Publisher`);
    const ogDescription=document.querySelector('meta[property="og:description"]');if(ogDescription)ogDescription.setAttribute('content',description);
  }

  function scheduleDetailRefresh(data){
    clearInterval(detailRefreshTimer);
    if(String(data.status).toLowerCase()!=='live')return;
    detailRefreshTimer=setInterval(()=>{if(!document.hidden)loadTournament(detailId,{silent:true,preserve:true});},30000);
  }

  search?.addEventListener('input',renderDirectory);
  filterButtons.forEach(btn=>btn.addEventListener('click',()=>{activeFilter=btn.dataset.filter;filterButtons.forEach(b=>b.classList.toggle('active',b===btn));renderDirectory();}));

  syncFederationFromUrl();
  const params=new URLSearchParams(location.search);
  const id=params.get('id');
  if(id){loadTournament(id,{preserve:false});}
  else{
    loadDirectory();
    directoryRefreshTimer=setInterval(()=>{if(!document.hidden)loadDirectory({silent:true});},60000);
  }

  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.getElementById('playerHistoryModal')?.hidden)closePlayerModal();});
  federationSelect?.addEventListener('change',()=>{activeFederation=federationFilterCode(federationSelect.value);updateFederationUrl(activeFederation);renderDirectory();});
  window.addEventListener('beforeunload',()=>{clearInterval(detailRefreshTimer);clearInterval(directoryRefreshTimer);});
})();
