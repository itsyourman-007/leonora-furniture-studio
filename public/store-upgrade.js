(() => {
  if (location.pathname.startsWith('/admin')) return;
  const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));
  const money=n=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(n)||0);
  let catalog=[];
  async function sync(){try{const r=await fetch('/api/products',{cache:'no-store'});if(!r.ok)return;catalog=await r.json();patchStore()}catch(e){console.warn('Catalog sync failed',e)}}
  function patchStore(){
    // Cards: show sale price only when a valid discounted price exists.
    document.querySelectorAll('.product-card').forEach(card=>{
      const link=card.querySelector('a[href*=\"#product/\"]'); if(!link)return;
      const id=link.getAttribute('href').split('#product/')[1]; const p=catalog.find(x=>x.id===id); if(!p)return;
      const price=card.querySelector('.product-price');
      if(price){const sale=p.discountedPrice&&Number(p.discountedPrice)<Number(p.price)?Number(p.discountedPrice):Number(p.price);price.innerHTML=p.discountedPrice&&Number(p.discountedPrice)<Number(p.price)?`<span class=\"price-old-u\">${money(p.price)}</span><span class=\"price-new-u\">${money(sale)}</span>`:money(sale)}
      const img=card.querySelector('.product-image img'); if(img&&p.images?.[0]&&img.src!==p.images[0])img.src=p.images[0];
    });
    const match=location.hash.match(/^#product\/([^/]+)/); if(match){patchProduct(match[1])}
  }
  function patchProduct(id){const p=catalog.find(x=>x.id===id);if(!p)return;const info=document.querySelector('.product-info');if(!info)return;
    const price=info.querySelector('.product-detail-price');
    if(price){price.innerHTML=p.discountedPrice&&Number(p.discountedPrice)<Number(p.price)?`<span class=\"price-old-u\">${money(p.price)}</span> <strong class=\"price-new-u\">${money(p.discountedPrice)}</strong>`:money(p.price)}
    const copy=info.querySelector('.detail-copy'); if(copy&&p.description)copy.textContent=p.description;
    let gallery=document.querySelector('.product-gallery'); if(gallery&&Array.isArray(p.images)&&p.images.length>1){
      gallery.innerHTML=`<div class=\"store-gallery-main\"><img id=\"store-main-image\" src=\"${esc(p.images[0])}\" alt=\"${esc(p.name)}\"></div><div class=\"store-gallery-thumbs\">${p.images.slice(0,15).map((src,i)=>`<button type=\"button\" class=\"store-thumb ${i===0?'active':''}\" data-src=\"${esc(src)}\"><img src=\"${esc(src)}\" alt=\"\"></button>`).join('')}</div>`;
      gallery.querySelectorAll('.store-thumb').forEach(btn=>btn.addEventListener('click',()=>{gallery.querySelector('#store-main-image').src=btn.dataset.src;gallery.querySelectorAll('.store-thumb').forEach(x=>x.classList.remove('active'));btn.classList.add('active')}));
    }
  }
  function style(){if(document.getElementById('store-upgrade-css'))return;const s=document.createElement('style');s.id='store-upgrade-css';s.textContent=`.price-old-u{text-decoration:line-through;color:#999;margin-right:6px}.price-new-u{font-weight:700}.store-gallery-main img{width:100%;height:min(72vh,720px);object-fit:cover;display:block}.store-gallery-thumbs{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:10px}.store-thumb{border:1px solid transparent;padding:0;background:#eee8df}.store-thumb.active{border-color:#111}.store-thumb img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block}@media(max-width:820px){.store-gallery-thumbs{grid-template-columns:repeat(4,1fr)}.store-gallery-main img{height:58vh}}`;document.head.appendChild(s)}
  style();
  window.addEventListener('load',()=>{sync();setTimeout(sync,900)});
  window.addEventListener('hashchange',()=>setTimeout(sync,120));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync()});
})();
