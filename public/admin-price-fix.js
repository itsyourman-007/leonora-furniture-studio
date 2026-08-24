(() => {
  if (!location.pathname.startsWith('/admin')) return;
  const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));
  const token=()=>localStorage.getItem('leonora_admin_token')||'';
  async function call(path,opts={}){opts.headers={...(opts.headers||{}),Authorization:`Bearer ${token()}`,'Content-Type':'application/json'};const r=await fetch(path,opts);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d}
  window.__leoAdminSaveProduct=async function(e){
    e.preventDefault();
    const f=new FormData(e.target);
    const images=[...Array(15)].map((_,i)=>f.get(`image${i+1}`)).filter(Boolean).slice(0,15);
    const original=Number(f.get('price')||0), sale=f.get('discountedPrice')?Number(f.get('discountedPrice')):null;
    if(!f.get('name')||!original||!f.get('category')||!images[0])return alert('Name, price, category and at least one image are required.');
    const product={name:f.get('name'),description:f.get('description'),category:f.get('category'),material:f.get('material'),stock:Number(f.get('stock')||0),customizable:f.get('customizable')==='on',colors:String(f.get('colors')||'').split(',').map(x=>x.trim()).filter(Boolean),fabrics:String(f.get('fabrics')||'').split(',').map(x=>x.trim()).filter(Boolean),dimensions:{width:Number(f.get('width')||0),depth:Number(f.get('depth')||0),height:Number(f.get('height')||0)},image:images[0],images,originalPrice:sale&&sale<original?original:null,discountedPrice:sale&&sale<original?sale:null,price:sale&&sale<original?sale:original};
    try{
      const inv=await call('/api/admin/inventory');
      const modal=document.getElementById('product-modal-u');
      const heading=modal?.querySelector('.modal-head-u h2')?.textContent||'';
      const existing=heading.includes('Edit')?inv.find(p=>p.name===product.name):null;
      let out;
      if(existing)out=await call('/api/admin/products/'+encodeURIComponent(existing.id),{method:'PUT',body:JSON.stringify(product)});
      else{out=await call('/api/admin/products',{method:'POST',body:JSON.stringify(product)});out=await call('/api/admin/products/'+encodeURIComponent(out.id),{method:'PUT',body:JSON.stringify(product)})}
      modal?.remove();alert('Furniture saved successfully. Store pricing, images and inventory are updated.');window.__leoAdminRefresh();
    }catch(err){alert(err.message)}
  };
})();
